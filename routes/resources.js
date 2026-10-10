'use strict';
const express = require('express');
const db = require('../src/db');
const { requireLogin } = require('../src/middleware');

const router = express.Router();
router.use(requireLogin);

/* ---------------- Fleet ---------------- */
router.get('/fleet', (req, res) => {
  const data = db.get();
  const types = db.fleetTypes(data);
  const editing = req.query.edit
    ? data.vehicles.find((v) => v.id === Number(req.query.edit)) || null
    : null;
  // Group vehicles by type: defined types in their order first, then any
  // vehicles whose type is no longer defined, under their own heading.
  const groups = types.map((t) => ({
    key: t.key, label: t.label, unit: t.unit,
    items: data.vehicles.filter((v) => v.type === t.key),
  }));
  data.vehicles.forEach((v) => {
    if (!types.some((t) => t.key === v.type)) {
      groups.push({ key: v.type, label: db.fleetTypeLabel(data, v.type), unit: '', items: [v] });
    }
  });
  res.render('fleet', { title: 'Fleet', types, groups, vehicles: data.vehicles, editing });
});

router.post('/fleet', (req, res) => {
  const data = db.get();
  const types = db.fleetTypes(data);
  const regNo = String(req.body.regNo || '').trim().toUpperCase();
  const type = types.some((t) => t.key === req.body.type) ? req.body.type : (types[0] ? types[0].key : 'dumper');
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

router.post('/fleet/types', (req, res) => {
  const data = db.get();
  const types = db.fleetTypes(data).slice();
  const label = String(req.body.label || '').trim();
  const unit = String(req.body.unit || '').trim();
  if (!label) return res.redirect('/fleet?error=Type name is required.');
  types.push({ key: db.fleetTypeSlug(label, types), label, unit, water: !!req.body.water });
  data.fleetTypes = types;
  db.save();
  res.redirect('/fleet?msg=Fleet type added.');
});

router.post('/fleet/types/delete', (req, res) => {
  const data = db.get();
  const types = db.fleetTypes(data);
  const key = String(req.body.key || '');
  if (types.length <= 1) return res.redirect('/fleet?error=At least one fleet type must remain.');
  if (data.vehicles.some((v) => v.type === key)) {
    return res.redirect('/fleet?error=This type has vehicles — delete those vehicles or change their type first.');
  }
  data.fleetTypes = types.filter((t) => t.key !== key);
  db.save();
  res.redirect('/fleet?msg=Fleet type deleted.');
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
  const unit = String(req.body.unit || '').trim() || 'CFT';
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
  // Bill count + total per company, so each company's billing is visible at a glance.
  const billStats = {};
  data.bills.forEach((b) => {
    const key = String(b.customerName || '').trim().toLowerCase();
    if (!billStats[key]) billStats[key] = { count: 0, total: 0 };
    billStats[key].count += 1;
    billStats[key].total += Number(b.total) || 0;
  });
  res.render('customers', { title: 'Companies', customers: data.customers, editing, billStats });
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
