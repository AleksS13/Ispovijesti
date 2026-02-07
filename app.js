require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const compression = require('compression'); // npm i compression
const { pool, query } = require('./db');

const homeRoutes = require('./routes/home');
const feedRoutes = require('./routes/feed');
const confessionRoutes = require('./routes/confessions');
const adminRoutes = require('./routes/admin');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const notificationsRoutes = require('./routes/notifications');
const approveRoutes = require('./routes/approve');

// DB test
pool.query('SELECT NOW()')
  .then(r => console.log('📅 DB test OK:', r.rows[0].now))
  .catch(err => console.error('❌ DB test FAIL:', err.message));

const app = express();

/* --------------------------------- Osnove --------------------------------- */
app.set('trust proxy', 1);               // ako si iza proxy-ja (Render/Heroku/Nginx)
app.disable('x-powered-by');             // sakrij Express header
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

/* ------------------------------- Security/Perf ----------------------------- */
app.use(helmet());                       // sigurnosni headeri (bez CSP po defaultu)
app.use(compression());                  // gzip/br (i za static)

/* ------------------------------- Parsers ---------------------------------- */
app.use(express.urlencoded({ extended: true, limit: '64kb' }));
app.use(express.json({ limit: '64kb' }));

/* -------------------------------- Statics --------------------------------- */
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  etag: true
}));

/* -------------------------------- Session --------------------------------- */
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev_secret_change_me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
}));

/* --------------------------- Globals za view-ove -------------------------- */
// currentUser u svim view-ovima
app.use((req, res, next) => {
  res.locals.currentUser = req.session?.user || null;
  next();
});

// helper za siguran prikaz korisničkog teksta (koristimo ga u detail.ejs)
app.use((req, res, next) => {
  res.locals.escape = (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  next();
});

// 🔔 broj nepročitanih notifikacija (samo za HTML GET-ove)
app.use(async (req, res, next) => {
  res.locals.unreadNotifCount = 0;

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
 app.use('/', approveRoutes); // (izbjegavamo duplikat approve rute)

// Landing
app.get('/', (req, res) => {
  res.redirect('/home');
});

/* ------------------------------- 404 & 500 -------------------------------- */
app.use((req, res) => {
  res.status(404).send('404 – Stranica nije pronađena.');
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).send('500 – Greška na serveru.');
});

/* --------------------------------- Start ---------------------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);
