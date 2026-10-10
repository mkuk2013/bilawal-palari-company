/* Excel import — parses the client's sheet in the browser (SheetJS),
 * maps its columns to bill lines (same rules as the PHP version),
 * and renders an editable preview form per sheet that posts to the
 * normal bill-create routes.
 *
 * Client workbooks hold ONE BILL PER SHEET (title rows, then a header
 * row, then data, then a totals row) and a file can carry several
 * sheets — each sheet becomes its own bill preview, so tables and
 * data never mix or shift. Columns are matched by header NAME, the
 * per-trip quantity column (Gln) is kept separate from a TOTAL Qty
 * column, and bill details (bill no, project, PO, period) printed
 * above the table are read from the sheet and pre-filled. */
(function () {
  'use strict';

  /* ---------------- Core (pure) logic ---------------- */
  function normKey(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var s = String(v == null ? '' : v).replace(/,/g, '').replace(/[^0-9.\-]/g, '');
    var n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }
  function fmtN(n) {
    if (!n) return '';
    return String(Math.round(n * 100) / 100);
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function normDate(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date && !isNaN(v)) {
      return v.getFullYear() + '-' + pad(v.getMonth() + 1) + '-' + pad(v.getDate());
    }
    if (typeof v === 'number' && v > 20000 && v < 80000) {
      var d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
      return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
    }
    var s = String(v).trim();
    var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3]);
    m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
    if (m) return m[3] + '-' + pad(+m[2]) + '-' + pad(+m[1]); // d/m/Y
    m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2})$/);
    if (m) return (2000 + (+m[3])) + '-' + pad(+m[2]) + '-' + pad(+m[1]);
    var ts = Date.parse(s);
    if (!isNaN(ts)) { var d2 = new Date(ts); return d2.getFullYear() + '-' + pad(d2.getMonth() + 1) + '-' + pad(d2.getDate()); }
    return s;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  var SYN = {
    date: ['date', 'day', 'dt'],
    veh: ['vehno', 'vehicle', 'vehicleno', 'veh', 'regno', 'reg', 'truckno', 'dumperno', 'tankerno', 'vehiclenumber'],
    dc: ['dcno', 'dc', 'dcnumber', 'challan', 'challanno'],
    desc: ['description', 'material', 'item', 'particulars', 'desc', 'materialname', 'itemname'],
    trip: ['trip', 'trips', 'nooftrips', 'notrips', 'tripno'],
    qty: ['gln', 'gallons', 'gallon', 'gal', 'gl', 'gallonspertrip', 'capacity', 'cft', 'pertripcft', 'qtycft', 'pertripqty', 'pertripquantity', 'quantitypertrip', 'quantitycftpertrip'],
    tqty: ['qty', 'quantity', 'totalqty', 'totalquantity', 'qtytotal'],
    rate: ['rate', 'price', 'ratepkr', 'rateper'],
    amt: ['amount', 'totalamount', 'amountpkr', 'total']
  };
  var CONTAINS = { veh: 'veh', gln: 'qty', gallon: 'qty', quantity: 'tqty', challan: 'dc', material: 'desc', desc: 'desc', amount: 'amt', trip: 'trip' };
  var STARTS = { date: 'date', rate: 'rate' };
  var IGNORE = ['sr', 'sno', 'srno', 'serial', 'serialno'];

  function findHeader(rows) {
    var limit = Math.min(rows.length, 12);
    for (var i = 0; i < limit; i++) {
      var map = {};
      var used = {};
      rows[i].forEach(function (cell, ci) {
        var key = normKey(cell);
        if (!key || IGNORE.indexOf(key) !== -1) return;
        Object.keys(SYN).forEach(function (field) {
          if (SYN[field].indexOf(key) !== -1 && !used[field]) { map[ci] = field; used[field] = 1; }
        });
      });
      rows[i].forEach(function (cell, ci) {
        if (map[ci]) return;
        var key = normKey(cell);
        if (!key || IGNORE.indexOf(key) !== -1) return;
        Object.keys(CONTAINS).forEach(function (needle) {
          if (!map[ci] && key.indexOf(needle) !== -1 && !used[CONTAINS[needle]]) { map[ci] = CONTAINS[needle]; used[CONTAINS[needle]] = 1; }
        });
        if (map[ci]) return;
        Object.keys(STARTS).forEach(function (needle) {
          if (!map[ci] && key.indexOf(needle) === 0 && !used[STARTS[needle]]) { map[ci] = STARTS[needle]; used[STARTS[needle]] = 1; }
        });
      });
      var fields = Object.keys(map).map(function (k) { return map[k]; });
      if (fields.length >= 3 && (fields.indexOf('veh') !== -1 || fields.indexOf('qty') !== -1 || fields.indexOf('tqty') !== -1)) {
        return { row: i, map: map };
      }
    }
    return null;
  }

  function extractMeta(rows, header) {
    var meta = { billNo: '', project: '', poNo: '', section: '', periodFrom: '', periodTo: '', billingMonth: '', type: '', waterCategory: '' };
    var upto = header ? Math.max(1, header.row) : Math.min(rows.length, 10);
    var dates = [];
    for (var i = 0; i < upto && i < rows.length; i++) {
      var cells = (rows[i] || []).map(function (c) { return c == null ? '' : String(c).trim(); });
      var nonEmpty = cells.filter(function (c) { return c !== ''; });
      var line = nonEmpty.join(' ');
      var m;
      if (!meta.billNo && (m = line.match(/bill\s*#?\s*no\.?\s*:?\s*([A-Za-z]{1,3}-?\d[\d-]*)/i))) meta.billNo = m[1].toUpperCase().replace(/^-+|-+$/g, '');
      if (!meta.poNo && (m = line.match(/PO-\d{2}-\d{4}-\d+/i))) meta.poNo = m[0].toUpperCase();
      if (/project/i.test(line)) {
        cells.forEach(function (c) {
          if (c !== '' && !/project/i.test(c) && c.length > meta.project.length) meta.project = c;
        });
      }
      if (!meta.section && nonEmpty.length === 1) {
        var s = nonEmpty[0];
        if (s.length <= 40 && !/bilawal|company|supplir|supplier|aggregate\s*&/i.test(s)) meta.section = s;
      }
      var re = /(\d{1,2})[\s.\-]+([A-Za-z]{3,9})[\s.\-]+(\d{4,5})/g;
      var one;
      while ((one = re.exec(line)) !== null) {
        var y = one[3];
        if (+y > 2100) y = y.slice(0, 3) + y.slice(-1); // '20226' -> '2026'
        var monTs = Date.parse('1 ' + one[2] + ' 2000');
        if (isNaN(monTs)) continue;
        var mon = new Date(monTs).getMonth();
        var yr = +y;
        var day = Math.min(+one[1], new Date(yr, mon + 1, 0).getDate());
        dates.push(yr + '-' + pad(mon + 1) + '-' + pad(day));
      }
    }
    if (dates.length) {
      meta.periodFrom = dates[0];
      meta.periodTo = dates[dates.length - 1];
      var d0 = new Date(dates[0] + 'T00:00:00');
      meta.billingMonth = d0.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
    var sec = meta.section.toLowerCase();
    if (sec.indexOf('water') !== -1) meta.type = 'water';
    else if (sec.indexOf('aggregate') !== -1 || sec.indexOf('sand') !== -1 || sec.indexOf('soil') !== -1 || sec.indexOf('crush') !== -1) meta.type = 'aggregate';
    // Water category: "Bore water" sheets are a different category from
    // "Sweet Water" even though both are water bills. An unclear section
    // on a water sheet falls back to Sweet Water (the historical default).
    if (meta.type === 'water') {
      if (sec.indexOf('bore') !== -1) meta.waterCategory = 'Bore Water';
      else meta.waterCategory = 'Sweet Water';
    }
    return meta;
  }

  function mapRows(rows, type, caps, mats, waterRate) {
    var header = findHeader(rows);
    var start = header ? header.row + 1 : 0;
    var map = header ? header.map : null;
    function col(field) {
      if (!map) return -1;
      var ks = Object.keys(map);
      for (var i = 0; i < ks.length; i++) if (map[ks[i]] === field) return +ks[i];
      return -1;
    }
    var lines = [], skipped = 0, skippedData = 0, afterTotal = false;
    // Client sheets merge cells vertically (vehicle/date/description span
    // several trip rows) — only the first row carries the value, so carry
    // the last seen values forward instead of dropping those rows.
    var lastVeh = '', lastDate = '', lastDesc = '';
    for (var i = start; i < rows.length; i++) {
      var r = rows[i] || [];
      var joined = r.map(function (c) { return c == null ? '' : String(c); }).join(' ').toLowerCase();
      if (!joined.trim()) { skipped++; continue; }
      function g(field, pos) {
        if (map) { var ci = col(field); return ci === -1 ? '' : (r[ci] == null ? '' : r[ci]); }
        return pos >= 0 ? (r[pos] == null ? '' : r[pos]) : '';
      }
      var f;
      if (type === 'aggregate') {
        f = { date: g('date', 0), veh: g('veh', 1), dc: g('dc', 2), desc: g('desc', 3), trip: g('trip', 4), qty: g('qty', 5), rate: g('rate', 6), tqty: g('tqty', -1) };
      } else if (!map && r.filter(function (c) { return String(c == null ? '' : c).trim() !== ''; }).length >= 7) {
        f = { date: g('date', 0), veh: g('veh', 1), dc: g('dc', 2), desc: '', trip: g('trip', 4), qty: g('qty', 5), rate: g('rate', 6), tqty: '' };
      } else {
        f = { date: g('date', 0), veh: g('veh', 1), dc: g('dc', 2), desc: g('desc', -1), trip: g('trip', 3), qty: g('qty', 4), rate: g('rate', 5), tqty: g('tqty', -1) };
      }
      var vehRaw = String(f.veh == null ? '' : f.veh).trim();
      var descRaw = String(f.desc == null ? '' : f.desc).trim();
      var dateRaw = String(f.date == null ? '' : f.date).trim();
      // A totals row is skipped but no longer ends the table: client sheets
      // print sub-totals between sections with real records below them, and
      // the old hard stop silently lost every record after the first one.
      if (joined.indexOf('total') !== -1 &&
          (vehRaw === '' || vehRaw.toLowerCase().indexOf('total') !== -1 || dateRaw.toLowerCase().indexOf('total') !== -1)) {
        afterTotal = true; skipped++; continue;
      }
      if (normKey(vehRaw) === 'vehno' || normKey(dateRaw) === 'date') {
        lastVeh = ''; lastDate = ''; lastDesc = '';
        skipped++; continue;
      }
      var hasVeh = vehRaw !== '';
      var hasDate = dateRaw !== '' && normDate(dateRaw) !== '';
      var qtySignal = num(f.qty) > 0 || num(f.tqty) > 0;
      if (afterTotal) {
        var resumes = (hasVeh && hasDate) || (hasVeh && qtySignal) || (hasDate && qtySignal);
        if (!resumes) { skipped++; if (qtySignal) skippedData++; continue; }
        afterTotal = false;
      }
      if (hasVeh) lastVeh = vehRaw;
      if (dateRaw !== '') lastDate = dateRaw;
      if (descRaw !== '') lastDesc = descRaw;
      var veh = hasVeh ? vehRaw : lastVeh;
      var desc = descRaw !== '' ? descRaw : lastDesc;
      var dateEff = dateRaw !== '' ? dateRaw : lastDate;
      // A line needs an identity of its own (vehicle, date, DC, description
      // or trips). Sheets end with an UNLABELLED totals row carrying only
      // quantity/amount figures — no identity — which must never become a
      // line; merged-cell continuations keep at least a DC or trips value.
      var dcRaw = String(f.dc == null ? '' : f.dc).trim();
      var hasIdentity = hasVeh || dateRaw !== '' || dcRaw !== '' || descRaw !== '' ||
        String(f.trip == null ? '' : f.trip).trim() !== '';
      if (!hasIdentity) { skipped++; continue; }
      var trip = num(f.trip);
      if (trip <= 0) trip = 1;
      var qty = num(f.qty);
      var tqty = num(f.tqty);
      if (qty <= 0 && tqty > 0) qty = Math.round((tqty / trip) * 100) / 100;
      if (qty <= 0 && veh !== '') { var cap = caps[normKey(veh)] || 0; if (cap > 0) qty = cap; }
      var rate = num(f.rate);
      if (rate <= 0) {
        if (type === 'water') rate = waterRate;
        else if (desc !== '') {
          var dk = normKey(desc);
          for (var j = 0; j < mats.length; j++) {
            if (mats[j].key === dk || (mats[j].key && (dk.indexOf(mats[j].key) !== -1 || mats[j].key.indexOf(dk) !== -1))) { rate = mats[j].rate; break; }
          }
        }
      }
      var line = {
        l_date: normDate(dateEff), l_veh: veh, l_dc: dcRaw,
        l_trip: fmtN(trip), l_rate: fmtN(rate)
      };
      if (type === 'aggregate') { line.l_desc = desc; line.l_qty = fmtN(qty); }
      else line.l_gal = fmtN(qty);
      lines.push(line);
    }
    return { lines: lines, skipped: skipped, skippedData: skippedData };
  }

  function sheetsFromWorkbook(wb, XLSX) {
    return wb.SheetNames.map(function (name) {
      return { title: name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' }) };
    });
  }

  function buildPreviews(sheets, fallbackType, caps, mats, waterRate) {
    var out = [];
    sheets.forEach(function (sh) {
      var header = findHeader(sh.rows);
      var meta = extractMeta(sh.rows, header);
      var type = meta.type || fallbackType;
      var mapped = mapRows(sh.rows, type, caps, mats, waterRate);
      if (!mapped.lines.length) return;
      var label = meta.section || sh.title;
      if (meta.billNo) label += ' — Bill ' + meta.billNo;
      out.push({ label: label, type: type, lines: mapped.lines, skipped: mapped.skipped, meta: meta });
    });
    return out;
  }

  var ImpCore = { normKey: normKey, num: num, normDate: normDate, findHeader: findHeader, extractMeta: extractMeta, mapRows: mapRows, sheetsFromWorkbook: sheetsFromWorkbook, buildPreviews: buildPreviews };
  if (typeof window !== 'undefined') window.ImpCore = ImpCore;
  if (typeof module !== 'undefined' && module.exports) module.exports = ImpCore;

  /* ---------------- Browser wiring ---------------- */
  if (typeof document === 'undefined') return;
  var fileInput = document.getElementById('impFile');
  if (!fileInput) return;
  var typeSel = document.getElementById('impType');
  var msg = document.getElementById('impMsg');
  var previewsEl = document.getElementById('impPreviews');
  var lastSheets = null;

  var CAPS = {};
  (window.IMP_VEHICLES || []).forEach(function (v) { CAPS[normKey(v.regNo)] = Number(v.capacity) || 0; });
  var MATS = (window.IMP_MATERIALS || []).map(function (m) {
    return { key: normKey(m.name), rate: Number(m.rate) || 0, unit: m.unit };
  });
  var WATER_RATE = Number(window.IMP_WATER_RATE) || 0;
  var TODAY = window.IMP_TODAY || '';
  var CUSTOMERS = window.IMP_CUSTOMERS || [];

  function customerOptions() {
    return CUSTOMERS.map(function (c) {
      return '<option value="' + esc(c.name) + '" data-project="' + esc(c.project || '') + '">' + esc(c.name) + '</option>';
    }).join('');
  }

  function render(previews) {
    if (!previews.length) {
      msg.style.display = '';
      msg.textContent = 'Is file mein koi bill line nahi mili. Column ke naam is tarah hon: Date, Vehicle No, DC No, Description, Trips, Quantity/Gln, Rate — ya sample template istemal karein.';
      previewsEl.innerHTML = '';
      return;
    }
    msg.style.display = 'none';
    var html = '';
    if (previews.length > 1) {
      html += '<p class="flash flash-ok">Is file mein <strong>' + previews.length + ' bill</strong> mile — har bill ka apna preview neeche hai. Jo save karna ho, usi card se <strong>Save bill</strong> dabayein.</p>';
    }
    previews.forEach(function (p) {
      var isAgg = p.type === 'aggregate';
      var meta = p.meta;
      var total = 0;
      p.lines.forEach(function (l) {
        total += (parseFloat(l.l_trip) || 0) * (parseFloat(isAgg ? l.l_qty : l.l_gal) || 0) * (parseFloat(l.l_rate) || 0);
      });
      html += '<section class="card">' +
        '<h2>Preview — ' + esc(p.label) + ' · ' + p.lines.length + ' lines mili' + (p.skipped ? ' (' + p.skipped + ' khaali/total rows chor di gayein)' : '') + '</h2>' +
        (isAgg ? '' : '<p class="muted">Water category: <span class="badge st-pending">' + esc(meta.waterCategory || 'Sweet Water') + '</span> <small>(sheet ke section se pehchani gayi — bill isi category mein save hoga)</small></p>') +
        '<p class="muted">Lines check kar lein — koi ghalti ho to yahi theek kar lein, fazool line ka ✕ daba dein. Phir bill ki details bhar kar Save bill dabayein. Estimated total: <strong>Rs ' +
        total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '</strong> (final total save hote waqt calculate hoga).</p>' +
        '<form method="post" action="' + (isAgg ? '/bills/aggregate' : '/bills/water') + '">' +
        (isAgg ? '' : '<input type="hidden" name="category" value="' + esc(meta.waterCategory || 'Sweet Water') + '">') +
        '<div class="form-grid">' +
        '<label>Bill No <input type="text" name="billNo" value="' + esc(meta.billNo) + '" placeholder="Khaali = auto number">' +
        '<small class="muted">' + (meta.billNo ? 'Sheet se parha gaya hai — badal sakte hain.' : 'Auto number lagega — chahein to apna number likh dein.') + '</small></label>' +
        '<label>Bill To (customer) <select name="customerName" class="custSel">' + customerOptions() + '</select></label>' +
        '<label>Project <input type="text" name="project" class="projInp" value="' + esc(meta.project) + '"></label>';
      if (isAgg) {
        html += '<label>Billing month <input type="text" name="billingMonth" value="' + esc(meta.billingMonth || new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })) + '"></label>';
      } else {
        html += '<label>Billing period from <input type="date" name="periodFrom" value="' + esc(meta.periodFrom || TODAY) + '"></label>' +
          '<label>Billing period to <input type="date" name="periodTo" value="' + esc(meta.periodTo || TODAY) + '"></label>' +
          '<label>PO No <input type="text" name="poNo" value="' + esc(meta.poNo) + '"></label>';
      }
      html += '<label>Date issued <input type="date" name="dateIssued" value="' + esc(TODAY) + '"></label></div>' +
        '<h3>Trip lines</h3><div class="table-wrap"><table class="table lines-table"><thead>' +
        (isAgg
          ? '<tr><th>Date</th><th>Veh No</th><th>DC No</th><th>Description</th><th>Trip</th><th>Per Trip Cft</th><th>Rate</th><th></th></tr>'
          : '<tr><th>Date</th><th>Veh No</th><th>DC #</th><th>Trip</th><th>Gallons / Trip</th><th>Rate</th><th></th></tr>') +
        '</thead><tbody>';
      p.lines.forEach(function (l) {
        html += '<tr>' +
          '<td><input type="text" name="l_date[]" value="' + esc(l.l_date) + '" size="10" placeholder="YYYY-MM-DD"></td>' +
          '<td><input type="text" name="l_veh[]" value="' + esc(l.l_veh) + '" size="9"></td>' +
          '<td><input type="text" name="l_dc[]" value="' + esc(l.l_dc) + '" size="6"></td>' +
          (isAgg ? '<td><input type="text" name="l_desc[]" value="' + esc(l.l_desc) + '"></td>' : '') +
          '<td><input type="number" name="l_trip[]" value="' + esc(l.l_trip) + '" step="any" style="width:70px"></td>' +
          (isAgg
            ? '<td><input type="number" name="l_qty[]" value="' + esc(l.l_qty) + '" step="any" style="width:100px"></td>'
            : '<td><input type="number" name="l_gal[]" value="' + esc(l.l_gal) + '" step="any" style="width:110px"></td>') +
          '<td><input type="number" name="l_rate[]" value="' + esc(l.l_rate) + '" step="any" style="width:90px"></td>' +
          '<td><button type="button" class="btn btn-small btn-danger" onclick="this.closest(\'tr\').remove()">✕</button></td></tr>';
      });
      html += '</tbody></table></div>' +
        '<button type="submit" class="btn btn-gold btn-block">Save bill</button></form></section>';
    });
    previewsEl.innerHTML = html;
    previewsEl.scrollIntoView({ behavior: 'smooth' });
  }

  function process() {
    if (!lastSheets) return;
    render(buildPreviews(lastSheets, typeSel.value, CAPS, MATS, WATER_RATE));
  }

  fileInput.addEventListener('change', function () {
    var file = fileInput.files && fileInput.files[0];
    if (!file) return;
    if (!window.XLSX) {
      msg.style.display = '';
      msg.textContent = 'Excel parhne wali library load nahi ho saki — internet check karke page refresh karein.';
      return;
    }
    file.arrayBuffer().then(function (buf) {
      lastSheets = sheetsFromWorkbook(XLSX.read(buf, { type: 'array', cellDates: true }), XLSX);
      process();
    }).catch(function () {
      msg.style.display = '';
      msg.textContent = 'File parhi nahi ja saki — sahi .xlsx ya .csv file upload karein.';
    });
  });

  var pasteBtn = document.getElementById('impPasteBtn');
  if (pasteBtn) {
    pasteBtn.addEventListener('click', function () {
      var text = (document.getElementById('impPaste').value || '').trim();
      if (!text) {
        msg.style.display = '';
        msg.textContent = 'Pehle box mein Excel se copy ki hui lines paste karein.';
        return;
      }
      if (!window.XLSX) {
        msg.style.display = '';
        msg.textContent = 'Excel parhne wali library load nahi ho saki — internet check karke page refresh karein.';
        return;
      }
      try {
        lastSheets = sheetsFromWorkbook(XLSX.read(text, { type: 'string', cellDates: true }), XLSX);
        process();
      } catch (e) {
        msg.style.display = '';
        msg.textContent = 'Paste kiya gaya text parha nahi ja saka.';
      }
    });
  }
  typeSel.addEventListener('change', process);
  document.addEventListener('change', function (ev) {
    if (ev.target && ev.target.classList && ev.target.classList.contains('custSel')) {
      var opt = ev.target.options[ev.target.selectedIndex];
      var form = ev.target.closest('form');
      var inp = form ? form.querySelector('.projInp') : null;
      if (inp && opt && opt.getAttribute('data-project')) inp.value = opt.getAttribute('data-project');
    }
  });
})();
