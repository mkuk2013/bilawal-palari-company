'use strict';

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** 49121.5 -> "49,121.50" */
function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** 1234 -> "1,234" (no decimals) */
function fmtInt(n) {
  return Number(n || 0).toLocaleString('en-US');
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** '2026-09-02' -> '02-Sep-2026' */
function fmtDate(d) {
  if (!d) return '—';
  const p = String(d).split('-');
  if (p.length !== 3) return String(d);
  return `${p[2]}-${MONTHS_SHORT[parseInt(p[1], 10) - 1]}-${p[0]}`;
}

/** '2026-09-02' -> 'September 2026' */
function monthLabel(d) {
  if (!d) return '';
  const p = String(d).split('-');
  if (p.length !== 3) return String(d);
  return `${MONTHS_LONG[parseInt(p[1], 10) - 1]} ${p[0]}`;
}

function toISO(date) {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${day}`;
}

function todayISO() {
  return toISO(new Date());
}

function isoDaysAgo(n) {
  const t = new Date();
  t.setDate(t.getDate() - n);
  return toISO(t);
}

const ONES = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n) {
  if (n < 20) return ONES[n];
  const t = TENS[Math.floor(n / 10)];
  return n % 10 ? `${t}-${ONES[n % 10]}` : t;
}

function threeDigits(n) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  let out = '';
  if (h) out += `${ONES[h]} Hundred`;
  if (r) out += (out ? ' ' : '') + twoDigits(r);
  return out;
}

function intWords(n) {
  if (n === 0) return 'Zero';
  let out = '';
  const billions = Math.floor(n / 1e9); n %= 1e9;
  const millions = Math.floor(n / 1e6); n %= 1e6;
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  if (billions) out += `${threeDigits(billions)} Billion `;
  if (millions) out += `${threeDigits(millions)} Million `;
  if (thousands) out += `${threeDigits(thousands)} Thousand `;
  if (rest) out += threeDigits(rest);
  return out.trim();
}

/** 6428800.52 -> "Rupees Six Million Four Hundred Twenty-Eight Thousand Eight Hundred and Fifty-Two Paisa Only" */
function amountInWords(amount) {
  const total = round2(amount);
  const rupees = Math.floor(total);
  const paisa = Math.round((total - rupees) * 100);
  let s = `Rupees ${intWords(rupees)}`;
  if (paisa > 0) s += ` and ${intWords(paisa)} Paisa`;
  return s + ' Only';
}

module.exports = { round2, fmt, fmtInt, fmtDate, monthLabel, todayISO, isoDaysAgo, amountInWords };
