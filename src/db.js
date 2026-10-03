'use strict';
/**
 * Tiny JSON-file data layer.
 * - DB file: data/db.json (override with env DATA_FILE, e.g. a mounted disk on Render).
 * - On first run (file missing) the database is created from seedData() below.
 * - Everything is kept in memory and written through to disk on every save().
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DATA_FILE =
  process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'db.json');

let db = null;

function seedData() {
  const dumpers = [
    ['TAM-143', 850], ['TAC-380', 1118], ['TAM-928', 850], ['TKJ-780', 600],
    ['TAC-901', 500], ['TAB-336', 1040], ['JV-2032', 920], ['TAE-994', 940],
    ['TAD-048', 590],
  ];
  const tankers = [
    ['TKN-429', 6000], ['C-8158', 6000], ['TKX-120', 6000], ['TTE-170', 6000],
    ['TUE-172', 6000], ['JU-4382', 15500], ['JV-2180', 16000], ['TLF-251', 14500],
    ['JT-4053', 2200], ['Y-0021', 2200], ['TKF-542', 2200], ['JT-1616', 2200],
    ['TAE-739', 2200], ['JP-0541', 2200], ['TKT-247', 2200], ['JT-1394', 2200],
    ['JP-5129', 2200], ['JT-8054', 2200],
  ];
  const vehicles = [];
  let vid = 0;
  dumpers.forEach(([regNo, capacity]) =>
    vehicles.push({ id: ++vid, regNo, type: 'dumper', capacity }));
  tankers.forEach(([regNo, capacity]) =>
    vehicles.push({ id: ++vid, regNo, type: 'tanker', capacity }));

  return {
    company: {
      name: 'Bilawal Palari & Company',
      tagline: 'All kinds of Aggregate & Heavy Machinery Supplier',
      office: 'No. 12, Industrial Area, Nooriabad, Sindh, Pakistan',
      phones: ['03013144738', '03451356722'],
      invoicePhone: '+92-300-1234567',
      email: 'billing@bilawalpalari.com',
      ntn: '7123456-7',
      preparedBy: { name: 'Muhammad Raza', designation: 'Billing Officer' },
      approvedBy: { name: 'Bilawal Palari', designation: 'Managing Director' },
      terms:
        'Payment due within 15 days from invoice date • Please reference Bill No. for all payments • Thank you for your business — we appreciate your partnership',
    },
    // Passwords are stored ONLY as bcrypt hashes (seed hashes are computed here at runtime).
    users: [
      {
        id: 1,
        username: 'admin',
        passwordHash: bcrypt.hashSync('admin123', 10),
        role: 'admin',
        active: true,
        createdAt: '2026-01-01',
      },
      {
        id: 2,
        username: 'staff',
        passwordHash: bcrypt.hashSync('user123', 10),
        role: 'user',
        active: true,
        createdAt: '2026-01-01',
      },
    ],
    customers: [
      {
        id: 1,
        name: 'U.TOPIA CONSTRUCTION',
        project: 'U.TOPIA Site Nooriabad Phase #3 Site 8',
        phone: '',
      },
    ],
    materials: [
      { id: 1, name: 'Coarse Aggregate', unit: 'CFT', rate: 57.79 },
      { id: 2, name: 'Salikua Sand', unit: 'CFT', rate: 46.84 },
      { id: 3, name: 'Backfilling Soil', unit: 'CFT', rate: 20.84 },
      { id: 4, name: 'Sweet Water', unit: 'gallon', rate: 2.95 },
    ],
    vehicles,
    orders: [],
    bills: [],
    seq: { user: 2, customer: 1, material: 4, vehicle: vid, order: 0, bill: 0 },
  };
}

function load() {
  if (db) return db;
  try {
    if (fs.existsSync(DATA_FILE)) {
      db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      return db;
    }
  } catch (err) {
    console.error('Could not read database file, reseeding:', err.message);
  }
  db = seedData();
  save();
  return db;
}

function save() {
  if (!db) return;
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

/** Next numeric id for a collection ('user' | 'customer' | 'material' | 'vehicle' | 'order'). */
function nextId(coll) {
  db.seq[coll] = (db.seq[coll] || 0) + 1;
  return db.seq[coll];
}

/** Next bill sequence number; bill numbers render as J-000001, J-000002, ... */
function nextBillSeq() {
  db.seq.bill = (db.seq.bill || 0) + 1;
  return db.seq.bill;
}

function billNoFor(seq) {
  return 'J-' + String(seq).padStart(6, '0');
}

module.exports = { load, get: load, save, nextId, nextBillSeq, billNoFor, DATA_FILE };
