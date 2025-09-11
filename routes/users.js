// routes/users.js
const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');

// Moje ispovijesti (ulogovani korisnik)
router.get('/me/confessions', requireAuth, async (req, res) => {
  const userId = req.session.user.id;
  try {
    const { rows } = await query(`
      SELECT c.id, c.text, c.status, c.created_at, c.published_at,
             (SELECT COUNT(*)::int FROM likes l     WHERE l.confession_id = c.id) AS like_count,
             (SELECT COUNT(*)::int FROM comments cm WHERE cm.confession_id = c.id) AS comment_count,
             (SELECT COUNT(*)::int FROM favorites f WHERE f.confession_id = c.id) AS favorite_count
      FROM confessions c
      WHERE c.user_id = $1
      ORDER BY c.created_at DESC
      LIMIT 100
    `, [userId]);

    res.render('users/my_confessions', {
      title: 'Moje ispovijesti',
      confessions: rows
    });
  } catch (err) {
    console.error('my confessions error', err);
    res.status(500).send('Greška pri učitavanju tvojih ispovijesti.');
  }
});

module.exports = router;
