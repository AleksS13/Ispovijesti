// middleware/auth.js
const { query } = require('../db');

function isBlockedRow(user) {
  if (!user) return false;
  if (user.is_active === false) return true;
  if (!user.blocked_until) return false;
  return new Date(user.blocked_until) > new Date();
}

async function loadUser(userId) {
  const { rows } = await query(
    `SELECT id, email, role, is_active, blocked_until
     FROM users WHERE id = $1`,
    [userId]
  );
  return rows[0] || null;
}

async function requireAuth(req, res, next) {
  try {
    if (!req.session.user) return res.redirect('/auth/login');
    // opcionalno: revalidate sesiju (svjež status iz baze)
    const fresh = await loadUser(req.session.user.id);
    if (!fresh) {
      req.session.destroy(() => {});
      return res.redirect('/auth/login');
    }
    if (isBlockedRow(fresh)) {
      return res.status(403).send('Nalog je blokiran ili deaktiviran.');
    }
    // ažuriraj sesiju svježim podacima
    req.session.user = {
      id: fresh.id,
      email: fresh.email,
      role: fresh.role,
    };
    next();
  } catch (e) {
    next(e);
  }
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user) {
    // ako nisi logovan ➝ login
    return res.redirect('/auth/login');
  }
  if (req.session.user.role !== 'admin') {
    // ako si logovan ali nisi admin ➝ 403
    return res.status(403).send('Samo za admine.');
  }
  next();
}


module.exports = { requireAuth, requireAdmin, loadUser };
