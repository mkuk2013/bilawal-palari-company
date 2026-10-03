'use strict';

function requireLogin(req, res, next) {
  if (!req.session || !req.session.user) return res.redirect('/login');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') {
    return res.status(403).render('denied', { title: 'Access denied' });
  }
  next();
}

/** Admin OR the user who created the record. */
function isOwnerOrAdmin(req, ownerUsername) {
  const u = req.session.user;
  return u.role === 'admin' || u.username === ownerUsername;
}

module.exports = { requireLogin, requireAdmin, isOwnerOrAdmin };
