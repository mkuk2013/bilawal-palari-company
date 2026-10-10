'use strict';
const express = require('express');
const db = require('../src/db');
const { requireLogin, isOwnerOrAdmin } = require('../src/middleware');
const { round2, todayISO, amountInWords, fmt, fmtDate, billCategoryLabel, waterCategoryFrom } = require('../src/utils');

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

function parseAggregateLines(body) {
  const rows = zipLines(body, ['l_date', 'l_veh', 'l_dc', 'l_desc', 'l_trip', 'l_qty', 'l_rate']);
  return rows.map((r) => {
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
}

function parseWaterLines(body) {
  const rows = zipLines(body, ['l_date', 'l_veh', 'l_dc', 'l_trip', 'l_gal', 'l_rate']);
  return rows.map((r) => {
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
}

/**
 * Decide the bill number for a save.
 * - Empty input  -> { billNo: null } meaning "assign the next auto number".
 * - Custom input -> used as-is, unless another bill already has it.
 * `exceptId` is the bill being edited (its own current number is allowed).
 */
function resolveBillNo(data, raw, exceptId) {
  const wanted = String(raw || '').trim();
  if (!wanted) return { billNo: null };
  const clash = data.bills.some(
    (b) => b.id !== exceptId && String(b.billNo || '').trim().toLowerCase() === wanted.toLowerCase()
  );
  if (clash) {
    return { error: `Bill number "${wanted}" is already used by another bill. Please choose a different number.` };
  }
  return { billNo: wanted };
}

function findBill(req) {
  return db.get().bills.find((b) => b.id === Number(req.params.id));
}

function nextAutoBillNo(data) {
  return db.billNoFor((data.seq.bill || 0) + 1);
}

router.get('/bills', (req, res) => {
  const data = db.get();
  let bills = [...data.bills].sort((a, b) => b.id - a.id);
  const type = req.query.type || '';
  const status = req.query.status || '';
  const company = String(req.query.company || '').trim();
  const q = String(req.query.q || '').trim();
  if (type) bills = bills.filter((b) => b.type === type);
  if (status) bills = bills.filter((b) => b.status === status);
  if (company) {
    const target = company.toLowerCase();
    bills = bills.filter((b) => String(b.customerName || '').trim().toLowerCase() === target);
  }
  if (q) {
    const needle = q.toLowerCase();
    const inBill = (b) =>
      [b.billNo, b.customerName, b.project, b.poNo, b.billingMonth, b.dateIssued, b.category]
        .some((v) => String(v || '').toLowerCase().includes(needle)) ||
      (b.lines || []).some((l) =>
        [l.vehNo, l.dcNo, l.description].some((v) => String(v || '').toLowerCase().includes(needle))
      );
    bills = bills.filter(inBill);
  }
  // Company list for the filter: registered companies first, then any name
  // that appears on a bill but is not registered (older bills stay findable).
  const names = [];
  const seen = new Set();
  const addName = (n) => {
    const name = String(n || '').trim();
    const key = name.toLowerCase();
    if (name && !seen.has(key)) {
      seen.add(key);
      names.push(name);
    }
  };
  data.customers.forEach((c) => addName(c.name));
  data.bills.forEach((b) => addName(b.customerName));
  names.sort((a, b) => a.localeCompare(b));
  const filteredTotal = round2(bills.reduce((s, b) => s + (Number(b.total) || 0), 0));
  res.render('bills/list', { title: 'Bills', bills, type, status, company, q, companies: names, filteredTotal, billCategoryLabel });
});

router.get('/bills/new/aggregate', (req, res) => {
  const data = db.get();
  res.render('bills/form-aggregate', {
    title: 'New aggregate bill',
    bill: null,
    nextBillNo: nextAutoBillNo(data),
    customers: data.customers,
    materials: data.materials.filter((m) => String(m.unit).toLowerCase() !== 'gallon'),
    vehicles: data.vehicles,
    today: todayISO(),
  });
});

router.post('/bills/aggregate', (req, res) => {
  const data = db.get();
  const lines = parseAggregateLines(req.body);
  if (!lines.length) return res.redirect('/bills/new/aggregate?error=Add at least one bill line.');
  const resolved = resolveBillNo(data, req.body.billNo, null);
  if (resolved.error) return res.redirect('/bills/new/aggregate?error=' + encodeURIComponent(resolved.error));
  const seq = db.nextBillSeq();
  const bill = {
    id: seq,
    billNo: resolved.billNo || db.billNoFor(seq),
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
  const water = data.materials.find((m) => String(m.unit).toLowerCase() === 'gallon');
  res.render('bills/form-water', {
    title: 'New sweet water bill',
    bill: null,
    nextBillNo: nextAutoBillNo(data),
    customers: data.customers,
    vehicles: data.vehicles.filter((v) => db.fleetTypeIsWater(data, v.type)),
    waterRate: water ? water.rate : 2.95,
    today: todayISO(),
  });
});

router.post('/bills/water', (req, res) => {
  const data = db.get();
  const lines = parseWaterLines(req.body);
  if (!lines.length) return res.redirect('/bills/new/water?error=Add at least one bill line.');
  const resolved = resolveBillNo(data, req.body.billNo, null);
  if (resolved.error) return res.redirect('/bills/new/water?error=' + encodeURIComponent(resolved.error));
  const seq = db.nextBillSeq();
  const bill = {
    id: seq,
    billNo: resolved.billNo || db.billNoFor(seq),
    type: 'water',
    category: waterCategoryFrom(req.body.category, 'water'),
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

/* ---- Excel import: template download + import page (parsing happens in the browser) ---- */
router.get('/bills/import/template', (req, res) => {
  const type = req.query.type === 'water' ? 'water' : 'aggregate';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="bill-import-template-${type}.csv"`);
  if (type === 'aggregate') {
    return res.send("Date,Vehicle No,DC No,Description,Trips,Quantity (CFT per trip),Rate\r\n2026-09-01,TAM-143,101,Coarse Aggregate,2,850,57.79\r\n2026-09-01,TAC-380,102,Salikua Sand,1,1118,46.84\r\n");
  }
  return res.send("Date,Vehicle No,DC No,Trips,Gallons (per trip),Rate\r\n2026-09-01,JV-2180,201,1,16000,2.95\r\n2026-09-01,TKN-429,202,2,6000,2.95\r\n");
});

router.get('/bills/import', (req, res) => {
  const data = db.get();
  const water = data.materials.find((m) => String(m.unit).toLowerCase() === 'gallon');
  res.render('bills/import', {
    title: 'Excel import',
    customers: data.customers,
    vehicles: data.vehicles,
    materials: data.materials,
    waterRate: water ? water.rate : 2.95,
    nextBillNo: nextAutoBillNo(data),
    today: todayISO(),
  });
});

router.get('/bills/:id/edit', (req, res) => {
  const data = db.get();
  const bill = findBill(req);
  if (!bill) return res.redirect('/bills?error=Bill not found.');
  if (bill.type === 'aggregate') {
    return res.render('bills/form-aggregate', {
      title: `Edit bill ${bill.billNo}`,
      bill,
      nextBillNo: bill.billNo,
      customers: data.customers,
      materials: data.materials.filter((m) => String(m.unit).toLowerCase() !== 'gallon'),
      vehicles: data.vehicles,
      today: todayISO(),
    });
  }
  const water = data.materials.find((m) => String(m.unit).toLowerCase() === 'gallon');
  return res.render('bills/form-water', {
    title: `Edit bill ${bill.billNo}`,
    bill,
    nextBillNo: bill.billNo,
    customers: data.customers,
    vehicles: data.vehicles.filter((v) => db.fleetTypeIsWater(data, v.type)),
    waterRate: water ? water.rate : 2.95,
    today: todayISO(),
  });
});

router.post('/bills/:id/update', (req, res) => {
  const data = db.get();
  const bill = findBill(req);
  if (!bill) return res.redirect('/bills?error=Bill not found.');
  const lines = bill.type === 'aggregate' ? parseAggregateLines(req.body) : parseWaterLines(req.body);
  if (!lines.length) return res.redirect(`/bills/${bill.id}/edit?error=Add at least one bill line.`);
  const resolved = resolveBillNo(data, req.body.billNo, bill.id);
  if (resolved.error) return res.redirect(`/bills/${bill.id}/edit?error=` + encodeURIComponent(resolved.error));

  const oldBillNo = bill.billNo;
  bill.billNo = resolved.billNo || oldBillNo;
  bill.customerName = String(req.body.customerName || '').trim();
  bill.project = String(req.body.project || '').trim();
  bill.dateIssued = String(req.body.dateIssued || bill.dateIssued || todayISO());
  if (bill.type === 'aggregate') {
    bill.billingMonth = String(req.body.billingMonth || '').trim();
  } else {
    bill.category = waterCategoryFrom(req.body.category, bill.type);
    bill.periodFrom = String(req.body.periodFrom || '');
    bill.periodTo = String(req.body.periodTo || '');
    bill.poNo = String(req.body.poNo || '').trim();
  }
  bill.lines = lines;
  bill.total = round2(lines.reduce((s, l) => s + l.amount, 0));
  bill.editedAt = todayISO();
  bill.editedBy = req.session.user.username;

  // Keep a linked order's reference in sync when the number changes.
  if (bill.billNo !== oldBillNo) {
    data.orders.forEach((o) => {
      if (o.billedBillId === bill.id) o.billedBillNo = bill.billNo;
    });
  }
  db.save();
  res.redirect(`/bills/${bill.id}?msg=Bill ${bill.billNo} updated.`);
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
    billCategoryLabel,
  });
}

router.get('/bills/:id', (req, res) => showBill(req, res, false));
router.get('/bills/:id/print', (req, res) => showBill(req, res, true));

router.post('/bills/:id/toggle-paid', (req, res) => {
  const bill = findBill(req);
  if (!bill) return res.redirect('/bills?error=Bill not found.');
  bill.status = bill.status === 'paid' ? 'unpaid' : 'paid';
  db.save();
  res.redirect(`/bills/${bill.id}?msg=Bill marked ${bill.status}.`);
});

router.post('/bills/:id/delete', (req, res) => {
  const data = db.get();
  const bill = findBill(req);
  if (!bill) return res.redirect('/bills?error=Bill not found.');
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
