require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const { pool, query } = require('./db');

const homeRoutes = require('./routes/home');
const feedRoutes = require('./routes/feed');
const confessionRoutes = require('./routes/confessions');
const adminRoutes = require('./routes/admin');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const notificationsRoutes = require('./routes/notifications');

// test konekcije
pool.query('SELECT NOW()').then(r => {
  console.log('📅 DB test OK:', r.rows[0].now);
}).catch(err => {
  console.error('❌ DB test FAIL:', err.message);
});

const app = express();

// EJS + statics + body
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// Session
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev_secret_change_me',
  resave: false,
  saveUninitialized: false,
}));

// currentUser u svim view-ovima
app.use((req, res, next) => {
  res.locals.currentUser = req.session?.user || null;
  next();
});

// 🔔 broj nepročitanih notifikacija
app.use(async (req, res, next) => {
  if (!req.session?.user) {
    res.locals.unreadNotifCount = 0;
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
    res.locals.unreadNotifCount = 0;
  }
  next();
});

// Rute
app.use('/', feedRoutes);
app.use('/', homeRoutes);
app.use('/', confessionRoutes);
app.use('/', adminRoutes);
app.use('/auth', authRoutes);
app.use('/', userRoutes);
app.use('/', notificationsRoutes);

// Landing
app.get('/', (req, res) => {
  res.redirect('/home');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
