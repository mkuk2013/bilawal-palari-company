'use strict';
const express = require('express');
const db = require('../src/db');
const { requireLogin, isOwnerOrAdmin } = require('../src/middleware');
const { round2, todayISO, amountInWords, fmt, fmtDate, billCategoryLabel, waterCategoryFrom } = require('../src/utils');
const { rowsToXlsx } = require('../src/xlsx');

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

/* ---- Excel (.xlsx) download — printed-invoice layout, professionally styled ---- */
router.get('/bills/:id/excel', (req, res) => {
  const bill = findBill(req);
  if (!bill) return res.redirect('/bills?error=Bill not found.');
  const data = db.get();
  const company = data.company;
  const groups = buildGroups(bill);
  const isWater = bill.type === 'water';
  const words = amountInWords(bill.total);
  const totalsTrips = bill.lines.reduce((sum, l) => sum + (Number(l.trip) || 0), 0);
  const totalsQty = isWater ? round2(bill.lines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0)) : 0;

  const S = (v) => [String(v ?? ''), 's', 0];
  const T = (v, st) => [String(v ?? ''), 's', st];
  const N = (v, st) => [Number(v) || 0, 'n', st];
  const FL = (st) => ['', 's', st];
  const E = null;
  const R = [];
  const M = [];
  const H = {};
  R.push([T(String(company.name).toUpperCase(), 4)]); M.push('A1:J1'); H[1] = 30;
  R.push([T(company.tagline, 5)]); M.push('A2:J2');
  R.push([T(`Office: ${company.office} · Ph: ${company.invoicePhone} · Email: ${company.email} · NTN: ${company.ntn}`, 6)]); M.push('A3:J3');
  R.push([]);
  R.push([T('BILL INVOICE' + (isWater ? ' — ' + billCategoryLabel(bill).toUpperCase() : ''), 7)]); M.push('A5:J5'); H[5] = 26;
  R.push([T('Bill To: ' + bill.customerName, 8), E, E, T('Project: ' + bill.project, 8)]); M.push('A6:C6', 'D6:J6');
  if (isWater) { R.push([T(`Billing Period: ${fmtDate(bill.periodFrom)} to ${fmtDate(bill.periodTo)}`, 8), E, E, T('PO No: ' + (bill.poNo || '—'), 8)]); M.push('A7:C7', 'D7:J7'); }
  else { R.push([T('Billing Month: ' + (bill.billingMonth || '—'), 8)]); M.push('A7:J7'); }
  R.push([T('Bill No: ' + bill.billNo, 8), E, E, T('Date Issued: ' + fmtDate(bill.dateIssued), 8)]); M.push('A8:C8', 'D8:J8');
  R.push([]);

  let stripe = 0;
  const dataRow = (cells) => {
    const z = stripe % 2 === 1;
    R.push(cells.map((c) => [c[0], c[1], z ? c[3] : c[2]]));
    stripe++;
  };

  if (!isWater) {
    R.push(['S.No', 'Date', 'Veh No', 'DC No', 'Description', 'Trip', 'Per Trip Cft', 'Total Cft', 'Rate (Rs.)', 'Amount (Rs.)'].map((h) => [h, 's', 10]));
    H[R.length] = 22;
    for (const g of groups) {
      R.push([T(String(g.key).toUpperCase(), 11)]); M.push(`A${R.length}:J${R.length}`);
      for (const l of g.lines) {
        dataRow([
          [l.sno, 'n', 14, 15], [fmtDate(l.date || ''), 's', 14, 15], [l.vehNo || '', 's', 14, 15], [l.dcNo || '', 's', 14, 15],
          [l.description || '', 's', 12, 13], [l.trip || 0, 'n', 18, 19], [l.perTripCft || 0, 'n', 16, 17], [l.totalCft || 0, 'n', 16, 17],
          [l.rate || 0, 'n', 16, 17], [l.amount || 0, 'n', 16, 17],
        ]);
      }
      const qtySum = fmt(g.lines.reduce((sum, x) => sum + (Number(x.totalCft) || 0), 0));
      R.push([T(`${g.key} Total — ${g.trips} dumper/trip(s) · ${qtySum} Cft`, 20), FL(20), FL(20), FL(20), FL(20), FL(20), FL(20), FL(20), FL(20), N(g.amount, 21)]);
      M.push(`A${R.length}:I${R.length}`);
    }
    R.push([]);
    R.push([T('SUMMARY OF TOTALS', 1)]);
    for (const g of groups) {
      R.push([T(g.key, 12), FL(12), FL(12), FL(12), FL(12), FL(12), FL(12), FL(12), FL(12), N(g.amount, 16)]);
      M.push(`A${R.length}:I${R.length}`);
    }
    R.push([T('GRAND TOTAL', 23), FL(23), FL(23), FL(23), FL(23), FL(23), FL(23), FL(23), FL(23), N(bill.total, 24)]);
    M.push(`A${R.length}:I${R.length}`);
    R.push([T('Amount in Words: ' + words, 26)]); M.push(`A${R.length}:J${R.length}`);
  } else {
    R.push(['Sr#', 'Date', 'Veh No', 'DC #', 'Description', 'Trip', 'Gln', 'Qty', 'Rate', 'Amount (Rs.)'].map((h) => [h, 's', 10]));
    H[R.length] = 22;
    for (const g of groups) {
      R.push([T('VEHICLE: ' + g.key, 11)]); M.push(`A${R.length}:J${R.length}`);
      for (const l of g.lines) {
        dataRow([
          [l.sno, 'n', 14, 15], [fmtDate(l.date || ''), 's', 14, 15], [l.vehNo || '', 's', 14, 15], [l.dcNo || '', 's', 14, 15],
          ['Water', 's', 12, 13], [l.trip || 0, 'n', 18, 19], [l.gallons || 0, 'n', 16, 17], [l.qty || 0, 'n', 16, 17],
          [l.rate || 0, 'n', 16, 17], [l.amount || 0, 'n', 16, 17],
        ]);
      }
      const qtySum = g.lines.reduce((sum, x) => sum + (Number(x.qty) || 0), 0);
      R.push([T('TOTAL Trips — ' + g.key, 20), FL(20), FL(20), FL(20), FL(20), N(g.trips, 22), FL(20), N(qtySum, 21), FL(20), N(g.amount, 21)]);
      M.push(`A${R.length}:E${R.length}`);
    }
    R.push([T('GRAND TOTAL', 23), FL(23), FL(23), FL(23), FL(23), N(totalsTrips, 25), FL(23), N(totalsQty, 24), FL(23), N(bill.total, 24)]);
    M.push(`A${R.length}:E${R.length}`);
    R.push([T('Amount in Words: ' + words, 26)]); M.push(`A${R.length}:J${R.length}`);
  }
  R.push([]);
  const signRow = R.length + 1;
  R.push([T('Prepared By:', 1), E, E, E, E, T('Approved By:', 1)]);
  M.push(`A${signRow}:E${signRow}`, `F${signRow}:J${signRow}`);
  R.push([S(`Name: ${company.preparedBy.name} · Designation: ${company.preparedBy.designation} · Date: ${fmtDate(bill.dateIssued)}`),
    E, E, E, E, S(`Name: ${company.approvedBy.name} · Designation: ${company.approvedBy.designation} · Date: ${fmtDate(bill.dateIssued)}`)]);
  M.push(`A${signRow + 1}:E${signRow + 1}`, `F${signRow + 1}:J${signRow + 1}`);
  R.push([]);
  R.push([S('Terms & Conditions: ' + company.terms)]); M.push(`A${R.length}:J${R.length}`);

  const buf = rowsToXlsx(R, 'Bill ' + bill.billNo, M, H);
  const safeNo = String(bill.billNo).replace(/[^A-Za-z0-9_-]+/g, '-');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Bill-${safeNo}.xlsx"`);
  res.send(buf);
});

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
