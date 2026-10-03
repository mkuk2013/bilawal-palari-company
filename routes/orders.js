'use strict';
const express = require('express');
const db = require('../src/db');
const { requireLogin, isOwnerOrAdmin } = require('../src/middleware');
const { round2, todayISO, monthLabel } = require('../src/utils');

const router = express.Router();
router.use(requireLogin);

const NEXT_STATUS = {
  Pending: ['Confirmed', 'Cancelled'],
  Confirmed: ['Delivered', 'Cancelled'],
  Delivered: [],
  Cancelled: [],
};

function visibleOrders(req) {
  const data = db.get();
  const me = req.session.user;
  const all =
    me.role === 'admin'
      ? data.orders
      : data.orders.filter((o) => o.createdBy === me.username);
  return [...all].sort((a, b) => b.id - a.id);
}

function findOrder(req) {
  return db.get().orders.find((o) => o.id === Number(req.params.id));
}

router.get('/orders', (req, res) => {
  let orders = visibleOrders(req);
  const status = req.query.status;
  if (status) orders = orders.filter((o) => o.status === status);
  res.render('orders/list', { title: 'Orders', orders, status: status || '' });
});

router.get('/orders/new', (req, res) => {
  const data = db.get();
  res.render('orders/form', {
    title: 'Book an order',
    customers: data.customers,
    materials: data.materials,
    vehicles: data.vehicles,
  });
});

router.post('/orders', (req, res) => {
  const data = db.get();
  const customer = data.customers.find((c) => c.id === Number(req.body.customerId));
  const material = data.materials.find((m) => m.id === Number(req.body.materialId));
  const vehicle = data.vehicles.find((v) => v.id === Number(req.body.vehicleId));
  if (!customer || !material) {
    return res.redirect('/orders/new?error=Please select a customer and a material.');
  }
  const trips = Math.max(0, parseFloat(req.body.trips) || 0);
  const perTripQty = Math.max(0, parseFloat(req.body.perTripQty) || 0);
  const rate = Math.max(0, parseFloat(req.body.rate) || 0);
  const order = {
    id: db.nextId('order'),
    customerId: customer.id,
    customerName: customer.name,
    materialId: material.id,
    materialName: material.name,
    materialUnit: material.unit,
    site: String(req.body.site || customer.project || '').trim(),
    deliveryDate: String(req.body.deliveryDate || todayISO()),
    vehicleId: vehicle ? vehicle.id : null,
    vehNo: vehicle ? vehicle.regNo : String(req.body.vehNo || '').trim(),
    trips,
    perTripQty,
    rate,
    amount: round2(trips * perTripQty * rate),
    status: 'Pending',
    createdBy: req.session.user.username,
    createdAt: todayISO(),
    billedBillId: null,
    billedBillNo: null,
  };
  data.orders.push(order);
  db.save();
  res.redirect('/orders?msg=Order booked.');
});

router.post('/orders/:id/status', (req, res) => {
  const order = findOrder(req);
  if (!order) return res.redirect('/orders?error=Order not found.');
  if (!isOwnerOrAdmin(req, order.createdBy)) {
    return res.redirect('/orders?error=You can only manage your own orders.');
  }
  const next = String(req.body.status || '');
  if ((NEXT_STATUS[order.status] || []).includes(next)) {
    order.status = next;
    db.save();
    return res.redirect('/orders?msg=Order status updated.');
  }
  res.redirect('/orders?error=That status change is not allowed.');
});

/**
 * Convert an order into a saved bill.
 * CFT materials become an aggregate bill, gallon materials become a sweet-water bill.
 */
router.post('/orders/:id/save-as-bill', (req, res) => {
  const data = db.get();
  const order = findOrder(req);
  if (!order) return res.redirect('/orders?error=Order not found.');
  if (!isOwnerOrAdmin(req, order.createdBy)) {
    return res.redirect('/orders?error=You can only manage your own orders.');
  }
  if (order.billedBillId) {
    return res.redirect(`/bills/${order.billedBillId}`);
  }
  if (order.status === 'Cancelled') {
    return res.redirect('/orders?error=A cancelled order cannot be saved as a bill.');
  }
  const seq = db.nextBillSeq();
  const type = order.materialUnit === 'gallon' ? 'water' : 'aggregate';
  const totalQty = round2(order.trips * order.perTripQty);
  let bill;
  if (type === 'aggregate') {
    bill = {
      id: seq,
      billNo: db.billNoFor(seq),
      type,
      customerName: order.customerName,
      project: order.site,
      billingMonth: monthLabel(order.deliveryDate),
      dateIssued: todayISO(),
      lines: [
        {
          date: order.deliveryDate,
          vehNo: order.vehNo,
          dcNo: '',
          description: order.materialName,
          trip: order.trips,
          perTripCft: order.perTripQty,
          totalCft: totalQty,
          rate: order.rate,
          amount: round2(totalQty * order.rate),
        },
      ],
    };
  } else {
    bill = {
      id: seq,
      billNo: db.billNoFor(seq),
      type,
      customerName: order.customerName,
      project: order.site,
      periodFrom: order.deliveryDate,
      periodTo: order.deliveryDate,
      poNo: '',
      dateIssued: todayISO(),
      lines: [
        {
          date: order.deliveryDate,
          vehNo: order.vehNo,
          dcNo: '',
          trip: order.trips,
          gallons: order.perTripQty,
          qty: totalQty,
          rate: order.rate,
          amount: round2(totalQty * order.rate),
        },
      ],
    };
  }
  bill.total = round2(bill.lines.reduce((s, l) => s + l.amount, 0));
  bill.status = 'unpaid';
  bill.savedBy = req.session.user.username;
  bill.fromOrderId = order.id;
  bill.createdAt = todayISO();
  data.bills.push(bill);
  order.billedBillId = bill.id;
  order.billedBillNo = bill.billNo;
  db.save();
  res.redirect(`/bills/${bill.id}?msg=Order saved as bill ${bill.billNo}.`);
});

router.post('/orders/:id/delete', (req, res) => {
  const data = db.get();
  const order = findOrder(req);
  if (!order) return res.redirect('/orders?error=Order not found.');
  if (!isOwnerOrAdmin(req, order.createdBy)) {
    return res.redirect('/orders?error=You can only manage your own orders.');
  }
  data.orders = data.orders.filter((o) => o.id !== order.id);
  db.save();
  res.redirect('/orders?msg=Order deleted.');
});

module.exports = router;
