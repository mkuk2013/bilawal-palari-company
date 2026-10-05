/* Excel import — parses the client's sheet in the browser (SheetJS),
 * maps its columns to bill lines (same rules as the PHP version),
 * and renders an editable preview form that posts to the normal
 * bill-create routes. */
(function () {
  var fileInput = document.getElementById('impFile');
  if (!fileInput) return;
  var typeSel = document.getElementById('impType');
  var msg = document.getElementById('impMsg');
  var lastRows = null;

  var CAPS = {};
  (window.IMP_VEHICLES || []).forEach(function (v) { CAPS[normKey(v.regNo)] = Number(v.capacity) || 0; });
  var MATS = (window.IMP_MATERIALS || []).map(function (m) {
    return { key: normKey(m.name), rate: Number(m.rate) || 0, unit: m.unit };
  });

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
    qty: ['quantity', 'qty', 'cft', 'pertripcft', 'qtycft', 'gallons', 'gallon', 'gal', 'gallonspertrip', 'capacity'],
    rate: ['rate', 'price', 'ratepkr', 'rateper']
  };
  function findHeader(rows) {
    var limit = Math.min(rows.length, 6);
    for (var i = 0; i < limit; i++) {
      var map = {};
      rows[i].forEach(function (cell, ci) {
        var key = normKey(cell);
        if (!key) return;
        Object.keys(SYN).forEach(function (field) {
          if (SYN[field].indexOf(key) !== -1 && Object.keys(map).indexOf(field) === -1 &&
              Object.keys(map).every(function (k) { return map[k] !== field; })) {
            if (!Object.values(map).includes(field)) map[ci] = field;
          }
        });
      });
      var fields = Object.values(map);
      if (fields.length >= 3 && (fields.indexOf('qty') !== -1 || fields.indexOf('veh') !== -1)) {
        return { row: i, map: map };
      }
    }
    return null;
  }

  function mapRows(rows, type) {
    var header = findHeader(rows);
    var start = header ? header.row + 1 : 0;
    var map = header ? header.map : null;
    function col(mapObj, field) {
      var ks = Object.keys(mapObj);
      for (var i = 0; i < ks.length; i++) if (mapObj[ks[i]] === field) return +ks[i];
      return -1;
    }
    var lines = [], skipped = 0, totalSeen = false;
    for (var i = start; i < rows.length; i++) {
      var r = rows[i] || [];
      var joined = r.map(function (c) { return c == null ? '' : String(c); }).join(' ').toLowerCase();
      if (!joined.trim()) { skipped++; continue; }
      if (joined.indexOf('grand total') !== -1) { totalSeen = true; skipped++; continue; }
      if (totalSeen) { skipped++; continue; }
      function g(field, pos) {
        if (map) { var ci = col(map, field); return ci === -1 ? '' : (r[ci] == null ? '' : r[ci]); }
        return r[pos] == null ? '' : r[pos];
      }
      var f;
      if (type === 'aggregate') {
        f = { date: g('date', 0), veh: g('veh', 1), dc: g('dc', 2), desc: g('desc', 3), trip: g('trip', 4), qty: g('qty', 5), rate: g('rate', 6) };
      } else if (!map && r.filter(function (c) { return String(c == null ? '' : c).trim() !== ''; }).length >= 7) {
        f = { date: g('date', 0), veh: g('veh', 1), dc: g('dc', 2), desc: '', trip: g('trip', 4), qty: g('qty', 5), rate: g('rate', 6) };
      } else {
        f = { date: g('date', 0), veh: g('veh', 1), dc: g('dc', 2), desc: '', trip: g('trip', 3), qty: g('qty', 4), rate: g('rate', 5) };
      }
      var veh = String(f.veh == null ? '' : f.veh).trim();
      var desc = String(f.desc == null ? '' : f.desc).trim();
      if (((desc.toLowerCase().indexOf('total') !== -1 || String(f.date).toLowerCase().indexOf('total') !== -1) && veh === '') ||
          normKey(veh) === 'vehno' || normKey(f.date) === 'date') { skipped++; continue; }
      var trip = num(f.trip), qty = num(f.qty), rate = num(f.rate);
      if (veh === '' && desc === '' && qty <= 0) { skipped++; continue; }
      if (trip <= 0) trip = 1;
      if (qty <= 0 && veh !== '') { var cap = CAPS[normKey(veh)] || 0; if (cap > 0) qty = cap; }
      if (rate <= 0) {
        if (type === 'water') rate = Number(window.IMP_WATER_RATE) || 0;
        else if (desc !== '') {
          var dk = normKey(desc);
          for (var j = 0; j < MATS.length; j++) {
            if (MATS[j].key === dk || (MATS[j].key && (dk.indexOf(MATS[j].key) !== -1 || MATS[j].key.indexOf(dk) !== -1))) { rate = MATS[j].rate; break; }
          }
        }
      }
      var line = {
        l_date: normDate(f.date), l_veh: veh, l_dc: String(f.dc == null ? '' : f.dc).trim(),
        l_trip: fmtN(trip), l_rate: fmtN(rate)
      };
      if (type === 'aggregate') { line.l_desc = desc; line.l_qty = fmtN(qty); }
      else line.l_gal = fmtN(qty);
      lines.push(line);
    }
    return { lines: lines, skipped: skipped };
  }

  function render(lines, type, skipped) {
    var isAgg = type === 'aggregate';
    document.getElementById('impForm').action = isAgg ? '/bills/aggregate' : '/bills/water';
    document.getElementById('impAggFields').style.display = isAgg ? '' : 'none';
    document.getElementById('impAggFields').querySelector('input').disabled = !isAgg;
    var wf = document.getElementById('impWaterFields');
    wf.hidden = isAgg;
    wf.querySelectorAll('input').forEach(function (inp) { inp.disabled = isAgg; });
    document.getElementById('impPreviewTitle').textContent =
      'Preview — ' + lines.length + ' lines mili' + (skipped ? ' (' + skipped + ' khaali/total rows chor di gayein)' : '');
    document.getElementById('impPreviewNote').textContent =
      'Lines check kar lein — koi ghalti ho to yahi theek kar lein, fazool line ka ✕ daba dein. Phir bill ki details bhar kar Save bill dabayein.';
    document.getElementById('impHead').innerHTML = isAgg
      ? '<tr><th>Date</th><th>Veh No</th><th>DC No</th><th>Description</th><th>Trip</th><th>Per Trip Cft</th><th>Rate</th><th></th></tr>'
      : '<tr><th>Date</th><th>Veh No</th><th>DC #</th><th>Trip</th><th>Gallons / Trip</th><th>Rate</th><th></th></tr>';
    var total = 0, html = '';
    lines.forEach(function (l) {
      total += (parseFloat(l.l_trip) || 0) * (parseFloat(isAgg ? l.l_qty : l.l_gal) || 0) * (parseFloat(l.l_rate) || 0);
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
    document.getElementById('impLines').innerHTML = html;
    document.getElementById('impTotal').textContent = total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    var card = document.getElementById('impPreviewCard');
    card.style.display = '';
    card.scrollIntoView({ behavior: 'smooth' });
  }

  function process() {
    if (!lastRows) return;
    var type = typeSel.value;
    var out = mapRows(lastRows, type);
    if (!out.lines.length) {
      msg.style.display = '';
      msg.textContent = 'Is file mein koi bill line nahi mili. Column is tartib par rakhein: Date, Vehicle No, DC No, Description, Trips, Quantity, Rate — ya sample template istemal karein.';
      document.getElementById('impPreviewCard').style.display = 'none';
      return;
    }
    msg.style.display = 'none';
    render(out.lines, type, out.skipped);
  }

  function rowsFromWorkbook(wb) {
    var ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
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
      lastRows = rowsFromWorkbook(XLSX.read(buf, { type: 'array', cellDates: true }));
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
        lastRows = rowsFromWorkbook(XLSX.read(text, { type: 'string', cellDates: true }));
        process();
      } catch (e) {
        msg.style.display = '';
        msg.textContent = 'Paste kiya gaya text parha nahi ja saka.';
      }
    });
  }
  typeSel.addEventListener('change', process);

  var bm = document.getElementById('impBillingMonth');
  if (bm && !bm.value) {
    bm.value = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
})();
