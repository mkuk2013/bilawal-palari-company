'use strict';
const express = require('express');
const db = require('../src/db');
const { requireLogin, isOwnerOrAdmin } = require('../src/middleware');
const { round2, todayISO, amountInWords, fmt, fmtDate } = require('../src/utils');

const router = express.Router();
router.use(requireLogin);

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/** Zip parallel form arrays (l_date[], l_veh[], ...) into row objects and drop blank rows. */
function zipLines(body, keys) {
  const first = body[keys[0]];
  const count = Array.isArray(first) ? first.length : first !== undefined ? 1 : 0;
  const rows = [];
  for (let i = 0; i < count; i++) {
    const row = {};
    keys.forEach((k) => {
      const v = body[k];
      row[k] = Array.isArray(v) ? v[i] : v;
    });
    const hasContent = keys.some((k) => String(row[k] || '').trim() !== '');
    if (hasContent) rows.push(row);
  }
  return rows;
}

function findBill(req) {
  return db.get().bills.find((b) => b.id === Number(req.params.id));
}

router.get('/bills', (req, res) => {
  let bills = [...db.get().bills].sort((a, b) => b.id - a.id);
  const type = req.query.type || '';
  const status = req.query.status || '';
  if (type) bills = bills.filter((b) => b.type === type);
  if (status) bills = bills.filter((b) => b.status === status);
  res.render('bills/list', { title: 'Bills', bills, type, status });
});

router.get('/bills/new/aggregate', (req, res) => {
  const data = db.get();
  res.render('bills/form-aggregate', {
    title: 'New aggregate bill',
    customers: data.customers,
    materials: data.materials.filter((m) => m.unit === 'CFT'),
    vehicles: data.vehicles,
    today: todayISO(),
  });
});

router.post('/bills/aggregate', (req, res) => {
  const data = db.get();
  const rows = zipLines(req.body, ['l_date', 'l_veh', 'l_dc', 'l_desc', 'l_trip', 'l_qty', 'l_rate']);
  const lines = rows.map((r) => {
    const trip = num(r.l_trip) || 1;
    const perTripCft = num(r.l_qty);
    const totalCft = round2(trip * perTripCft);
    const rate = num(r.l_rate);
    return {
      date: String(r.l_date || ''),
      vehNo: String(r.l_veh || '').trim(),
      dcNo: String(r.l_dc || '').trim(),
      description: String(r.l_desc || '').trim(),
      trip,
      perTripCft,
      totalCft,
      rate,
      amount: round2(totalCft * rate),
    };
  });
  if (!lines.length) return res.redirect('/bills/new/aggregate?error=Add at least one bill line.');
  const seq = db.nextBillSeq();
  const bill = {
    id: seq,
    billNo: db.billNoFor(seq),
    type: 'aggregate',
    customerName: String(req.body.customerName || '').trim(),
    project: String(req.body.project || '').trim(),
    billingMonth: String(req.body.billingMonth || '').trim(),
    dateIssued: String(req.body.dateIssued || todayISO()),
    lines,
    total: round2(lines.reduce((s, l) => s + l.amount, 0)),
    status: 'unpaid',
    savedBy: req.session.user.username,
    fromOrderId: null,
    createdAt: todayISO(),
  };
  data.bills.push(bill);
  db.save();
  res.redirect(`/bills/${bill.id}?msg=Bill ${bill.billNo} saved.`);
});

router.get('/bills/new/water', (req, res) => {
  const data = db.get();
  const water = data.materials.find((m) => m.unit === 'gallon');
  res.render('bills/form-water', {
    title: 'New sweet water bill',
    customers: data.customers,
    vehicles: data.vehicles.filter((v) => v.type === 'tanker'),
    waterRate: water ? water.rate : 2.95,
    today: todayISO(),
  });
});

router.post('/bills/water', (req, res) => {
  const data = db.get();
  const rows = zipLines(req.body, ['l_date', 'l_veh', 'l_dc', 'l_trip', 'l_gal', 'l_rate']);
  const lines = rows.map((r) => {
    const trip = num(r.l_trip) || 1;
    const gallons = num(r.l_gal);
    const qty = round2(trip * gallons);
    const rate = num(r.l_rate);
    return {
      date: String(r.l_date || ''),
      vehNo: String(r.l_veh || '').trim(),
      dcNo: String(r.l_dc || '').trim(),
      trip,
      gallons,
      qty,
      rate,
      amount: round2(qty * rate),
    };
  });
  if (!lines.length) return res.redirect('/bills/new/water?error=Add at least one bill line.');
  const seq = db.nextBillSeq();
  const bill = {
    id: seq,
    billNo: db.billNoFor(seq),
    type: 'water',
    customerName: String(req.body.customerName || '').trim(),
    project: String(req.body.project || '').trim(),
    periodFrom: String(req.body.periodFrom || ''),
    periodTo: String(req.body.periodTo || ''),
    poNo: String(req.body.poNo || '').trim(),
    dateIssued: String(req.body.dateIssued || todayISO()),
    lines,
    total: round2(lines.reduce((s, l) => s + l.amount, 0)),
    status: 'unpaid',
    savedBy: req.session.user.username,
    fromOrderId: null,
    createdAt: todayISO(),
  };
  data.bills.push(bill);
  db.save();
  res.redirect(`/bills/${bill.id}?msg=Bill ${bill.billNo} saved.`);
});

/** Group aggregate lines by material, water lines by vehicle, preserving first-seen order. */
function buildGroups(bill) {
  const groups = [];
  const byKey = new Map();
  const keyOf = bill.type === 'aggregate' ? (l) => l.description : (l) => l.vehNo;
  bill.lines.forEach((line, idx) => {
    const key = keyOf(line) || '—';
    if (!byKey.has(key)) {
      const g = { key, lines: [], trips: 0, amount: 0 };
      byKey.set(key, g);
      groups.push(g);
    }
    const g = byKey.get(key);
    g.lines.push({ ...line, sno: idx + 1 });
    g.trips += Number(line.trip) || 0;
    g.amount = round2(g.amount + line.amount);
  });
  return groups;
}

function showBill(req, res, autoprint) {
  const bill = findBill(req);
  if (!bill) return res.redirect('/bills?error=Bill not found.');
  const groups = buildGroups(bill);
  const totals = {
    trips: bill.lines.reduce((s, l) => s + (Number(l.trip) || 0), 0),
    gallons: bill.type === 'water' ? round2(bill.lines.reduce((s, l) => s + l.qty, 0)) : 0,
  };
  res.render('bills/show', {
    title: `Bill ${bill.billNo}`,
    bill,
    groups,
    totals,
    autoprint,
    words: amountInWords(bill.total),
    fmt,
    fmtDate,
  });
}

router.get('/bills/:id', (req, res) => showBill(req, res, false));
router.get('/bills/:id/print', (req, res) => showBill(req, res, true));

router.post('/bills/:id/toggle-paid', (req, res) => {
  const bill = findBill(req);
  if (!bill) return res.redirect('/bills?error=Bill not found.');
  if (!isOwnerOrAdmin(req, bill.savedBy)) {
    return res.redirect(`/bills/${bill.id}?error=Only the person who saved this bill or an admin can change its status.`);
  }
  bill.status = bill.status === 'paid' ? 'unpaid' : 'paid';
  db.save();
  res.redirect(`/bills/${bill.id}?msg=Bill marked ${bill.status}.`);
});

router.post('/bills/:id/delete', (req, res) => {
  const data = db.get();
  const bill = findBill(req);
  if (!bill) return res.redirect('/bills?error=Bill not found.');
  if (!isOwnerOrAdmin(req, bill.savedBy)) {
    return res.redirect('/bills?error=You cannot delete this bill.');
  }
  data.orders.forEach((o) => {
    if (o.billedBillId === bill.id) {
      o.billedBillId = null;
      o.billedBillNo = null;
    }
  });
  data.bills = data.bills.filter((b) => b.id !== bill.id);
  db.save();
  res.redirect('/bills?msg=Bill deleted.');
});

module.exports = router;
