# Bilawal Palari & Company — Standalone App

Orders, billing, fleet and admin monitoring for **Bilawal Palari & Company**
(All kinds of Aggregate & Heavy Machinery Supplier, Nooriabad, Sindh).

This is a self-contained Node.js + Express app. It does **not** depend on any
external platform: push it to GitHub and deploy it on any Node hosting
(Render, Railway, a VPS, etc.). Data is stored in a JSON file
(`data/db.json`) which is created automatically with seed data on first run.

## Features

- **Login required for everything**, with two roles: **Admin** and **User (staff)**
- **Orders** — book orders (customer, material, site, delivery date, vehicle,
  trips × per-trip qty × rate; amount auto-calculated), status flow
  Pending → Confirmed → Delivered / Cancelled. Staff see only their own
  orders; admin sees everyone's. One tap **"Save as bill"** converts an order
  into a saved bill that records who saved it.
- **Billing, two bill types**
  - *Aggregate bill* — grouped by material with subtotals, Summary of Totals,
    Grand Total with amount in words, Prepared/Approved By, terms footer.
  - *Sweet Water bill* — lines grouped per tanker with a TOTAL Trips row per
    vehicle, plus overall trips / gallons / amount totals.
  - Bills get automatic numbers (`J-000001`, `J-000002`, …), a paid/unpaid
    status, type filter, and a print view styled like the printed invoice
    (navy + gold, company logo).
- **Fleet** — 9 dumpers and 18 water tankers seeded with capacities;
  selecting a vehicle auto-fills the per-trip quantity. Add/edit vehicles.
- **Materials & Customers** — add/edit lists; materials carry a unit
  (CFT or gallon) and a default rate.
- **Admin monitoring** — today's sales, daily sales for the last 14 days
  (issued bills + delivered orders, no double-counting converted orders),
  totals across all bills, latest orders from all users, order counts by
  status, and full user management (create admin/user accounts, change role,
  deactivate, reset password). Company profile (name, phones, NTN, signatories,
  terms) is editable by the admin.
- **PWA** — installable on mobile, navy/gold theme, floating bottom
  navigation bar.

## Default logins

| Role  | Username | Password   |
|-------|----------|------------|
| Admin | `admin`  | `admin123` |
| User  | `staff`  | `user123`  |

> ⚠️ **Change both default passwords immediately after your first login**
> (top bar → *Password*; admins can also reset any account under
> Admin → Manage users). Passwords are stored only as bcrypt hashes.

## Run locally

```bash
npm install
npm start
# open http://localhost:3000
```

The server listens on `process.env.PORT || 3000`.

### Environment variables

| Variable         | Purpose                          | Default                        |
|------------------|----------------------------------|--------------------------------|
| `PORT`           | Port to listen on                | `3000`                         |
| `SESSION_SECRET` | Session cookie secret            | dev fallback (set in production!) |
| `DATA_FILE`      | Path of the JSON database file   | `data/db.json` in the project  |

## Deploy on Render

1. Push this folder to a GitHub repo.
2. In Render: **New → Web Service**, connect the repo.
3. Build command: `npm install` — Start command: `npm start`.
4. Environment: set `SESSION_SECRET` to a long random string.
   (`PORT` is provided by Render automatically.)
5. **Persistence note:** Render's free filesystem is ephemeral — when the
   service restarts, `data/db.json` resets to the seed data. For permanent
   data, add a **Persistent Disk** (e.g. mounted at `/var/data`) and set the
   env var `DATA_FILE=/var/data/db.json`.

## Deploy on Railway

1. Push this folder to a GitHub repo.
2. In Railway: **New Project → Deploy from GitHub repo**. Railway detects
   Node and runs `npm start` (it sets `PORT` automatically).
3. Variables: set `SESSION_SECRET` to a long random string.
4. **Persistence note:** add a **Volume** to the service and set
   `DATA_FILE` to a path inside the volume (e.g. `/data/db.json`), otherwise
   data resets to seed on redeploys.

## Project structure

```
server.js            App entry point (npm start)
src/
  db.js              JSON data layer + seed data (accounts, company, fleet, materials)
  utils.js           Money/date formatting, amount-in-words
  middleware.js      Login / admin guards
routes/
  auth.js            Login, logout, change password
  main.js            Dashboard
  orders.js          Orders + convert order to bill
  bills.js           Aggregate & sweet-water bills, print view
  resources.js       Fleet, materials, customers
  admin.js           Monitoring, user management, company profile
views/               EJS templates (invoice in views/bills/show.ejs)
public/              CSS, JS, logo, PWA manifest, service worker, icons
data/                db.json is created here on first run (git-ignored)
```

## Resetting the data

Delete `data/db.json` and restart the app — it will be recreated with the
seed data (default accounts, fleet, materials and the U.TOPIA customer).
