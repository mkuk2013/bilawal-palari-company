'use strict';
const path = require('path');
const express = require('express');
const session = require('express-session');

const db = require('./src/db');
db.load(); // creates data/db.json with seed data on first run

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'bilawal-palari-dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 12 }, // 12 hours
  })
);

// Common template locals
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.company = db.get().company;
  res.locals.path = req.path;
  res.locals.msg = req.query.msg || null;
  res.locals.errorMsg = req.query.error || null;
  res.locals.title = 'Bilawal Palari & Company';
  next();
});

app.use('/', require('./routes/auth'));
app.use('/', require('./routes/main'));
app.use('/', require('./routes/orders'));
app.use('/', require('./routes/bills'));
app.use('/', require('./routes/resources'));
app.use('/', require('./routes/admin'));

app.use((req, res) => {
  res.status(404).render('denied', { title: 'Not found', notFound: true });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Something went wrong. Please try again.');
});

app.listen(PORT, () => {
  console.log(`Bilawal Palari & Company app running on http://localhost:${PORT}`);
});
