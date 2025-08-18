// middleware/authHandlers.js
const bcrypt = require('bcryptjs');
const { query } = require('../db');

// helper
function isBlockedRow(user) {
  if (!user) return false;
  if (user.is_active === false) return true;
  if (!user.blocked_until) return false;
  return new Date(user.blocked_until) > new Date();
}

async function registerHandler(req, res) {
  const { email, password } = req.body;
  try {
    if (!email || !password) {
      return res.status(400).render('auth/register', { error: 'Email i lozinka su obavezni.', title: 'Registracija' });
    }
    if (password.length < 6) {
      return res.status(400).render('auth/register', { error: 'Lozinka mora imati najmanje 6 karaktera.', title: 'Registracija' });
    }

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await query(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, $2)
       RETURNING id, email, role, is_active, blocked_until`,
      [email, hash]
    );
    const user = rows[0];

    // kreiraj sesiju
    req.session.user = { id: user.id, email: user.email, role: user.role };
    return res.redirect('/home');
  } catch (err) {
    // 23505 = unique_violation (CITEXT email unique)
    if (err.code === '23505') {
      return res.status(409).render('auth/register', { error: 'Email je već registrovan.', title: 'Registracija' });
    }
    console.error('register error:', err);
    return res.status(500).render('auth/register', { error: 'Greška na serveru.', title: 'Registracija' });
  }
}

async function loginHandler(req, res) {
  const { email, password } = req.body;
  try {
    const { rows } = await query(
      `SELECT id, email, password_hash, role, is_active, blocked_until
       FROM users WHERE email = $1`,
      [email]
    );
    const user = rows[0];
    if (!user) {
      return res.status(401).render('auth/login', { error: 'Pogrešan email ili lozinka.', title: 'Prijava' });
    }
    if (isBlockedRow(user)) {
      return res.status(403).render('auth/login', { error: 'Nalog je blokiran ili deaktiviran.', title: 'Prijava' });
    }

    const ok = await bcrypt.compare(password, user.password_hash || '');
    if (!ok) {
      return res.status(401).render('auth/login', { error: 'Pogrešan email ili lozinka.', title: 'Prijava' });
    }

    // sesija – nemoj čuvati password_hash
    req.session.user = { id: user.id, email: user.email, role: user.role };
    return res.redirect('/home');
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).render('auth/login', { error: 'Greška na serveru.', title: 'Prijava' });
  }
}

function logoutHandler(req, res) {
  req.session.destroy(() => {
    res.redirect('/auth/login');
  });
}

module.exports = { registerHandler, loginHandler, logoutHandler };
