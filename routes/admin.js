'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../src/db');
const { requireAdmin } = require('../src/middleware');
const { round2, todayISO, isoDaysAgo, fmtDate } = require('../src/utils');

const router = express.Router();
router.use(requireAdmin);

/**
 * Sales for one date = bills issued that day + orders delivered that day.
 * Orders that were converted into bills are excluded from the order side so
 * the same work is never counted twice.
 */
function salesFor(data, date) {
  let bills = 0;
  let orders = 0;
  data.bills.forEach((b) => {
    if (b.dateIssued === date) bills += b.total;
  });
  data.orders.forEach((o) => {
    if (o.status === 'Delivered' && o.deliveryDate === date && !o.billedBillId) {
      orders += o.amount;
    }
  });
  return { bills: round2(bills), orders: round2(orders), total: round2(bills + orders) };
}

router.get('/admin', (req, res) => {
  const data = db.get();
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const date = isoDaysAgo(i);
    days.push({ date, label: fmtDate(date), ...salesFor(data, date) });
  }
  const statusCounts = { Pending: 0, Confirmed: 0, Delivered: 0, Cancelled: 0 };
  data.orders.forEach((o) => {
    if (statusCounts[o.status] !== undefined) statusCounts[o.status]++;
  });
  const paidTotal = round2(data.bills.filter((b) => b.status === 'paid').reduce((s, b) => s + b.total, 0));
  const unpaidTotal = round2(data.bills.filter((b) => b.status === 'unpaid').reduce((s, b) => s + b.total, 0));
  res.render('admin/dashboard', {
    title: 'Admin — Monitoring',
    today: salesFor(data, todayISO()),
    days: [...days].reverse(),
    billsTotals: {
      count: data.bills.length,
      total: round2(paidTotal + unpaidTotal),
      paid: paidTotal,
      unpaid: unpaidTotal,
    },
    statusCounts,
    latestOrders: [...data.orders].sort((a, b) => b.id - a.id).slice(0, 10),
  });
});

/* ---------------- User management ---------------- */
router.get('/admin/users', (req, res) => {
  res.render('admin/users', { title: 'Admin — Users', users: db.get().users });
});

router.post('/admin/users', (req, res) => {
  const data = db.get();
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const role = req.body.role === 'admin' ? 'admin' : 'user';
  if (!username) return res.redirect('/admin/users?error=Username is required.');
  if (password.length < 6) return res.redirect('/admin/users?error=Password must be at least 6 characters.');
  if (data.users.some((u) => u.username.toLowerCase() === username)) {
    return res.redirect('/admin/users?error=That username is already taken.');
  }
  data.users.push({
    id: db.nextId('user'),
    username,
    passwordHash: bcrypt.hashSync(password, 10),
    role,
    active: true,
    createdAt: todayISO(),
  });
  db.save();
  res.redirect('/admin/users?msg=User created.');
});

function findUser(req) {
  return db.get().users.find((u) => u.id === Number(req.params.id));
}

function activeAdminCount(data) {
  return data.users.filter((u) => u.role === 'admin' && u.active).length;
}

router.post('/admin/users/:id/role', (req, res) => {
  const data = db.get();
  const user = findUser(req);
  if (!user) return res.redirect('/admin/users?error=User not found.');
  const role = req.body.role === 'admin' ? 'admin' : 'user';
  if (user.id === req.session.user.id && role !== 'admin') {
    return res.redirect('/admin/users?error=You cannot remove your own admin role.');
  }
  if (user.role === 'admin' && role !== 'admin' && activeAdminCount(data) <= 1) {
    return res.redirect('/admin/users?error=At least one active admin is required.');
  }
  user.role = role;
  db.save();
  res.redirect('/admin/users?msg=Role updated.');
});

router.post('/admin/users/:id/toggle-active', (req, res) => {
  const data = db.get();
  const user = findUser(req);
  if (!user) return res.redirect('/admin/users?error=User not found.');
  if (user.id === req.session.user.id) {
    return res.redirect('/admin/users?error=You cannot deactivate your own account.');
  }
  if (user.active && user.role === 'admin' && activeAdminCount(data) <= 1) {
    return res.redirect('/admin/users?error=At least one active admin is required.');
  }
  user.active = !user.active;
  db.save();
  res.redirect('/admin/users?msg=Account updated.');
});

router.post('/admin/users/:id/reset-password', (req, res) => {
  const user = findUser(req);
  if (!user) return res.redirect('/admin/users?error=User not found.');
  const password = String(req.body.password || '');
  if (password.length < 6) {
    return res.redirect('/admin/users?error=Password must be at least 6 characters.');
  }
  user.passwordHash = bcrypt.hashSync(password, 10);
  db.save();
  res.redirect('/admin/users?msg=Password reset.');
});

/* ---------------- Company profile ---------------- */
router.get('/admin/company', (req, res) => {
  res.render('admin/company', { title: 'Admin — Company profile', company: db.get().company });
});

router.post('/admin/company', (req, res) => {
  const data = db.get();
  const c = data.company;
  c.name = String(req.body.name || c.name).trim();
  c.tagline = String(req.body.tagline || '').trim();
  c.office = String(req.body.office || '').trim();
  c.phones = [String(req.body.phone1 || '').trim(), String(req.body.phone2 || '').trim()].filter(Boolean);
  c.invoicePhone = String(req.body.invoicePhone || '').trim();
  c.email = String(req.body.email || '').trim();
  c.ntn = String(req.body.ntn || '').trim();
  c.preparedBy = {
    name: String(req.body.preparedName || '').trim(),
    designation: String(req.body.preparedDesignation || '').trim(),
  };
  c.approvedBy = {
    name: String(req.body.approvedName || '').trim(),
    designation: String(req.body.approvedDesignation || '').trim(),
  };
  c.terms = String(req.body.terms || '').trim();
  db.save();
  res.redirect('/admin/company?msg=Company profile saved.');
});

module.exports = router;
