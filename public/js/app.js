'use strict';

// Register the service worker (PWA).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

const money = (n) =>
  Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

document.addEventListener('DOMContentLoaded', () => {
  initOrderForm();
  initCustomerProject();
  initBillForm();
});

/* ---------------- Order form helpers ---------------- */
function initOrderForm() {
  const form = document.getElementById('orderForm');
  if (!form) return;
  const material = document.getElementById('materialId');
  const vehicle = document.getElementById('vehicleId');
  const site = document.getElementById('site');
  const customer = document.getElementById('customerId');
  const trips = document.getElementById('trips');
  const qty = document.getElementById('perTripQty');
  const rate = document.getElementById('rate');
  const preview = document.getElementById('amountPreview');

  const applyMaterial = () => {
    const opt = material.options[material.selectedIndex];
    if (opt && opt.dataset.rate) rate.value = opt.dataset.rate;
  };
  const applyVehicle = () => {
    const opt = vehicle.options[vehicle.selectedIndex];
    if (opt && opt.dataset.capacity) qty.value = opt.dataset.capacity;
  };
  const applyCustomer = () => {
    const opt = customer.options[customer.selectedIndex];
    if (opt && opt.dataset.project && !site.value) site.value = opt.dataset.project;
  };
  const recalc = () => {
    preview.textContent = money(
      (parseFloat(trips.value) || 0) * (parseFloat(qty.value) || 0) * (parseFloat(rate.value) || 0)
    );
  };
  material.addEventListener('change', () => { applyMaterial(); recalc(); });
  vehicle.addEventListener('change', () => { applyVehicle(); recalc(); });
  customer.addEventListener('change', applyCustomer);
  [trips, qty, rate].forEach((el) => el.addEventListener('input', recalc));
  applyMaterial();
  applyVehicle();
  applyCustomer();
  recalc();
}

/* Bill header: prefill project from the selected customer. */
function initCustomerProject() {
  const sel = document.getElementById('customerName');
  const project = document.getElementById('project');
  if (!sel || !project) return;
  const apply = () => {
    const opt = sel.options[sel.selectedIndex];
    if (opt && opt.dataset.project) project.value = opt.dataset.project;
  };
  sel.addEventListener('change', apply);
  apply();
}

/* ---------------- Bill line forms ---------------- */
function initBillForm() {
  const form = document.getElementById('billForm');
  if (!form) return;
  const type = form.dataset.billType;
  const body = document.getElementById('linesBody');
  const addBtn = document.getElementById('addRowBtn');
  const grand = document.getElementById('grandTotal');
  const caps = window.VEH_CAPS || {};
  const rates = window.MAT_RATES || {};
  const matNames = window.MAT_NAMES || [];
  const defDate = window.DEFAULT_DATE || '';

  function rowHtml() {
    if (type === 'aggregate') {
      const options = matNames
        .map((n) => `<option value="${n}">${n}</option>`)
        .join('');
      return `<td><input type="date" name="l_date[]" value="${defDate}"></td>
        <td><input type="text" name="l_veh[]" class="l-veh" list="vehList" placeholder="Veh No"></td>
        <td><input type="text" name="l_dc[]" placeholder="DC No"></td>
        <td><select name="l_desc[]" class="l-desc">${options}</select></td>
        <td><input type="number" name="l_trip[]" class="l-trip" value="1" min="0" step="any"></td>
        <td><input type="number" name="l_qty[]" class="l-qty" min="0" step="any" placeholder="Cft / trip"></td>
        <td><input type="number" name="l_rate[]" class="l-rate" min="0" step="any"></td>
        <td class="amt">0.00</td>
        <td><button type="button" class="row-del" title="Remove line">✕</button></td>`;
    }
    return `<td><input type="date" name="l_date[]" value="${defDate}"></td>
      <td><input type="text" name="l_veh[]" class="l-veh" list="vehList" placeholder="Tanker No"></td>
      <td><input type="text" name="l_dc[]" placeholder="DC #"></td>
      <td><input type="number" name="l_trip[]" class="l-trip" value="1" min="0" step="any"></td>
      <td><input type="number" name="l_gal[]" class="l-qty" min="0" step="any" placeholder="Gallons"></td>
      <td><input type="number" name="l_rate[]" class="l-rate" min="0" step="any" value="${window.WATER_RATE || ''}"></td>
      <td class="amt">0.00</td>
      <td><button type="button" class="row-del" title="Remove line">✕</button></td>`;
  }

  function recalc() {
    let total = 0;
    body.querySelectorAll('tr').forEach((tr) => {
      const trip = parseFloat(tr.querySelector('.l-trip').value) || 0;
      const qty = parseFloat(tr.querySelector('.l-qty').value) || 0;
      const rate = parseFloat(tr.querySelector('.l-rate').value) || 0;
      const amt = trip * qty * rate;
      tr.querySelector('.amt').textContent = money(amt);
      total += amt;
    });
    grand.textContent = money(total);
  }

  function addRow() {
    const tr = document.createElement('tr');
    tr.innerHTML = rowHtml();
    body.appendChild(tr);
    if (type === 'aggregate') {
      const desc = tr.querySelector('.l-desc');
      if (desc && rates[desc.value] !== undefined) {
        tr.querySelector('.l-rate').value = rates[desc.value];
      }
    }
    recalc();
  }

  addBtn.addEventListener('click', addRow);
  body.addEventListener('click', (e) => {
    if (e.target.classList.contains('row-del')) {
      e.target.closest('tr').remove();
      recalc();
    }
  });
  body.addEventListener('input', (e) => {
    const tr = e.target.closest('tr');
    if (!tr) return;
    if (e.target.classList.contains('l-veh')) {
      const cap = caps[String(e.target.value || '').trim().toUpperCase()];
      const qtyInput = tr.querySelector('.l-qty');
      if (cap !== undefined && qtyInput && !qtyInput.value) qtyInput.value = cap;
    }
    recalc();
  });
  body.addEventListener('change', (e) => {
    if (e.target.classList.contains('l-desc')) {
      const tr = e.target.closest('tr');
      const r = rates[e.target.value];
      if (r !== undefined) tr.querySelector('.l-rate').value = r;
      recalc();
    }
  });

  addRow(); // start with one blank line
}
