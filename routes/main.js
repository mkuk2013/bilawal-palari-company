'use strict';
const express = require('express');
const db = require('../src/db');
const { requireLogin } = require('../src/middleware');
const { round2, todayISO } = require('../src/utils');

const router = express.Router();

router.get('/', requireLogin, (req, res) => {
  const data = db.get();
  const me = req.session.user;
  const isAdmin = me.role === 'admin';
  const orders = isAdmin
    ? data.orders
    : data.orders.filter((o) => o.createdBy === me.username);
  const billsTotal = round2(data.bills.reduce((s, b) => s + b.total, 0));
  const unpaidTotal = round2(
    data.bills.filter((b) => b.status === 'unpaid').reduce((s, b) => s + b.total, 0)
  );
  const todayOrders = orders.filter((o) => o.createdAt === todayISO()).length;
  res.render('dashboard', {
    title: 'Home',
    stats: {
      totalOrders: orders.length,
      pending: orders.filter((o) => o.status === 'Pending').length,
      delivered: orders.filter((o) => o.status === 'Delivered').length,
      todayOrders,
      billsCount: data.bills.length,
      billsTotal,
      unpaidTotal,
      vehicles: data.vehicles.length,
      customers: data.customers.length,
    },
    recentOrders: [...orders].sort((a, b) => b.id - a.id).slice(0, 5),
    recentBills: [...data.bills].sort((a, b) => b.id - a.id).slice(0, 5),
  });
});

module.exports = router;
