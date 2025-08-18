// routes/home.js
const express = require('express');
const router = express.Router();
const { query } = require('../db');

// Početna stranica (tretiramo je isto kao "najnovije")
router.get('/', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT c.id, c.text,
             (SELECT COUNT(*) FROM likes l WHERE l.confession_id = c.id) AS like_count,
             (SELECT COUNT(*) FROM comments cm WHERE cm.confession_id = c.id) AS comment_count
      FROM confessions c
      WHERE c.status = 'published'
      ORDER BY c.created_at DESC
      LIMIT 20
    `);

    res.render('home', {
  title: 'Početna',
  currentUser: req.session ? req.session.user : null, // ✅ sigurnija provjera
  confessions: rows,
  activeTab: 'latest'
});

  } catch (err) {
    console.error('home route error', err);
    res.status(500).send('Greška na serveru.');
  }
});

module.exports = router;
