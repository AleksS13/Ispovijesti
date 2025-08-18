const express = require('express');
const router = express.Router();
const { registerHandler, loginHandler, logoutHandler } = require('../middleware/authHandlers');

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/home');
  res.render('auth/login', { error: null, title: 'Prijava' });
});

router.post('/login', loginHandler);

router.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/home');
  res.render('auth/register', { error: null, title: 'Registracija' });
});

router.post('/register', registerHandler);

router.post('/logout', logoutHandler);

module.exports = router;
