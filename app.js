require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet'); // npm i helmet
const { pool, query } = require('./db');

const homeRoutes = require('./routes/home');
const feedRoutes = require('./routes/feed');
const confessionRoutes = require('./routes/confessions');
const adminRoutes = require('./routes/admin');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const notificationsRoutes = require('./routes/notifications');
const approveRoutes = require('./routes/approve');



// Test konekcije na DB
pool.query('SELECT NOW()')
  .then(r => console.log('📅 DB test OK:', r.rows[0].now))
  .catch(err => console.error('❌ DB test FAIL:', err.message));

const app = express();

/* --------------------------------- Osnove --------------------------------- */
// Ako deployaš iza proxy-ja (Render/Heroku/Nginx) — omogućava secure cookie
app.set('trust proxy', 1);

// View engine + views
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Statics
app.use(express.static(path.join(__dirname, 'public')));

// Parsers
app.use(express.urlencoded({ extended: true }));
app.use(express.json()); // za JSON body (korisno za API/AJAX)

/* ------------------------------- Security --------------------------------- */
app.use(helmet()); // osnovni sigurnosni headeri

/* -------------------------------- Session --------------------------------- */
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev_secret_change_me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,              // štiti od XSS (cookie nije dostupan iz JS-a)
    sameSite: 'lax',             // razumna default zaštita CSRF-a za forme
    secure: process.env.NODE_ENV === 'production' // true samo iza HTTPS-a
  }
}));

/* --------------------------- Globals za view-ove -------------------------- */
// currentUser u svim view-ovima
app.use((req, res, next) => {
  res.locals.currentUser = req.session?.user || null;
  next();
});

// 🔔 broj nepročitanih notifikacija (samo za HTML GET zahtjeve)
app.use(async (req, res, next) => {
  res.locals.unreadNotifCount = 0;

  // radi samo za GET i kad browser traži HTML (ne za API, assete, itd.)
  const accept = (req.get('accept') || '').toLowerCase();
  const wantsHtml = accept.includes('text/html');

  if (!wantsHtml || req.method !== 'GET' || !req.session?.user) {
    return next();
  }

  try {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS cnt
       FROM notifications
       WHERE user_id = $1 AND is_read = FALSE`,
      [req.session.user.id]
    );
    res.locals.unreadNotifCount = rows[0]?.cnt || 0;
  } catch (e) {
    console.error('unread notif count error:', e);
  }
  next();
});

/* ---------------------------------- Rute ---------------------------------- */
app.use('/', feedRoutes);
app.use('/', homeRoutes);
app.use('/', confessionRoutes);
app.use('/', adminRoutes);
app.use('/auth', authRoutes);
app.use('/', userRoutes);
app.use('/', notificationsRoutes);
app.use('/', approveRoutes);


// Landing
app.get('/', (req, res) => {
  res.redirect('/home');
});

/* --------------------------------- Start ---------------------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
