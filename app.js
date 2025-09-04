require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const { pool } = require('./db');

const homeRoutes = require('./routes/home');
const feedRoutes = require('./routes/feed');
const confessionRoutes = require('./routes/confessions');
const adminRoutes = require('./routes/admin');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const apiRoutes = require('./routes/api');

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

// Session (⚠️ ovo MORA ići prije ruta!)
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev_secret_change_me',
  resave: false,
  saveUninitialized: false,
}));

// Globalni helper u EJS-u (svaki view vidi currentUser)
app.use((req, res, next) => {
  res.locals.currentUser = req.session?.user || null;
  next();
});

// Rute
app.use('/', feedRoutes);
app.use('/', homeRoutes);
app.use('/', confessionRoutes);
app.use('/', adminRoutes);
app.use('/auth', authRoutes);
app.use('/', userRoutes);



// Landing page
app.get('/', (req, res) => {
  res.redirect('/home');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
