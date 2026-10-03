'use strict';
const express = require('express');
const db = require('../src/db');
const { requireLogin } = require('../src/middleware');

const router = express.Router();
router.use(requireLogin);

/* ---------------- Fleet ---------------- */
router.get('/fleet', (req, res) => {
  const data = db.get();
  const editing = req.query.edit
    ? data.vehicles.find((v) => v.id === Number(req.query.edit)) || null
    : null;
  res.render('fleet', {
    title: 'Fleet',
    dumpers: data.vehicles.filter((v) => v.type === 'dumper'),
    tankers: data.vehicles.filter((v) => v.type === 'tanker'),
    editing,
  });
});

router.post('/fleet', (req, res) => {
  const data = db.get();
  const regNo = String(req.body.regNo || '').trim().toUpperCase();
  const type = req.body.type === 'tanker' ? 'tanker' : 'dumper';
  const capacity = Math.max(0, parseFloat(req.body.capacity) || 0);
  if (!regNo) return res.redirect('/fleet?error=Vehicle number is required.');
  if (req.body.id) {
    const v = data.vehicles.find((x) => x.id === Number(req.body.id));
    if (v) Object.assign(v, { regNo, type, capacity });
  } else {
    data.vehicles.push({ id: db.nextId('vehicle'), regNo, type, capacity });
  }
  db.save();
  res.redirect('/fleet?msg=Vehicle saved.');
});

router.post('/fleet/:id/delete', (req, res) => {
  const data = db.get();
  data.vehicles = data.vehicles.filter((v) => v.id !== Number(req.params.id));
  db.save();
  res.redirect('/fleet?msg=Vehicle deleted.');
});

/* ---------------- Materials ---------------- */
router.get('/materials', (req, res) => {
  const data = db.get();
  const editing = req.query.edit
    ? data.materials.find((m) => m.id === Number(req.query.edit)) || null
    : null;
  res.render('materials', { title: 'Materials & Supplies', materials: data.materials, editing });
});

router.post('/materials', (req, res) => {
  const data = db.get();
  const name = String(req.body.name || '').trim();
  const unit = req.body.unit === 'gallon' ? 'gallon' : 'CFT';
  const rate = Math.max(0, parseFloat(req.body.rate) || 0);
  if (!name) return res.redirect('/materials?error=Material name is required.');
  if (req.body.id) {
    const m = data.materials.find((x) => x.id === Number(req.body.id));
    if (m) Object.assign(m, { name, unit, rate });
  } else {
    data.materials.push({ id: db.nextId('material'), name, unit, rate });
  }
  db.save();
  res.redirect('/materials?msg=Material saved.');
});

router.post('/materials/:id/delete', (req, res) => {
  const data = db.get();
  data.materials = data.materials.filter((m) => m.id !== Number(req.params.id));
  db.save();
  res.redirect('/materials?msg=Material deleted.');
});

/* ---------------- Customers ---------------- */
router.get('/customers', (req, res) => {
  const data = db.get();
  const editing = req.query.edit
    ? data.customers.find((c) => c.id === Number(req.query.edit)) || null
    : null;
  res.render('customers', { title: 'Customers', customers: data.customers, editing });
});

router.post('/customers', (req, res) => {
  const data = db.get();
  const name = String(req.body.name || '').trim();
  const project = String(req.body.project || '').trim();
  const phone = String(req.body.phone || '').trim();
  if (!name) return res.redirect('/customers?error=Customer name is required.');
  if (req.body.id) {
    const c = data.customers.find((x) => x.id === Number(req.body.id));
    if (c) Object.assign(c, { name, project, phone });
  } else {
    data.customers.push({ id: db.nextId('customer'), name, project, phone });
  }
  db.save();
  res.redirect('/customers?msg=Customer saved.');
});

router.post('/customers/:id/delete', (req, res) => {
  const data = db.get();
  data.customers = data.customers.filter((c) => c.id !== Number(req.params.id));
  db.save();
  res.redirect('/customers?msg=Customer deleted.');
});

module.exports = router;
