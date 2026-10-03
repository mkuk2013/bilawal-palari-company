'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../src/db');
const { requireLogin } = require('../src/middleware');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { title: 'Sign in', error: null });
});

router.post('/login', (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = db
    .get()
    .users.find((u) => u.username.toLowerCase() === username);
  if (!user || !user.active || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.render('login', {
      title: 'Sign in',
      error: 'Invalid username or password, or this account is deactivated.',
    });
  }
  req.session.user = { id: user.id, username: user.username, role: user.role };
  res.redirect('/');
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

router.get('/account/password', requireLogin, (req, res) => {
  res.render('account-password', { title: 'Change password' });
});

router.post('/account/password', requireLogin, (req, res) => {
  const data = db.get();
  const user = data.users.find((u) => u.id === req.session.user.id);
  const current = String(req.body.currentPassword || '');
  const next = String(req.body.newPassword || '');
  const confirm = String(req.body.confirmPassword || '');
  if (!user || !bcrypt.compareSync(current, user.passwordHash)) {
    return res.redirect('/account/password?error=Current password is incorrect.');
  }
  if (next.length < 6) {
    return res.redirect('/account/password?error=New password must be at least 6 characters.');
  }
  if (next !== confirm) {
    return res.redirect('/account/password?error=New passwords do not match.');
  }
  user.passwordHash = bcrypt.hashSync(next, 10);
  db.save();
  res.redirect('/?msg=Your password has been changed.');
});

module.exports = router;
