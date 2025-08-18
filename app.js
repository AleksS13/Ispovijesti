require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const homeRoutes = require('./routes/home');
const feedRoutes = require('./routes/feed');
const confessionRoutes = require('./routes/confessions');
const adminRoutes = require('./routes/admin');
const { pool } = require('./db');

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
app.use(express.urlencoded({ extended: true })); // form-urlencoded
app.use('/', feedRoutes);
app.use('/', homeRoutes);
app.use('/', confessionRoutes);
app.use('/', adminRoutes);


// Session (za početak MemoryStore je OK lokalno)
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
}));

// Globalni helper u EJS-u
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

// Rute
const authRoutes = require('./routes/auth');
app.use('/auth', authRoutes);

app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/home');
  res.render('index', { title: 'Ispovijesti' });
});

app.get('/home', (req, res) => {
  res.render('home', {
    title: 'Početna',
    currentUser: req.session.user || null,
    confessions: [],   // makar prazan niz
    activeTab: 'latest'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
