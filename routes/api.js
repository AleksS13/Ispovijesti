// routes/api.js
const express = require('express');
const router = express.Router();
const { query } = require('../db');

// Like preko API-ja
router.post('/confessions/:id/like', async (req, res) => {
  const confessionId = req.params.id;
  try {
    let userId = null;
    let sessionTokenHash = null;
    if (req.session?.user) userId = req.session.user.id;
    else sessionTokenHash = req.sessionID;

    await query(
      `INSERT INTO likes (confession_id, user_id, session_token_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [confessionId, userId, sessionTokenHash]
    );

    const { rows } = await query(
      `SELECT COUNT(*)::int AS like_count FROM likes WHERE confession_id = $1`,
      [confessionId]
    );

    res.json({ success: true, likeCount: rows[0].like_count });
  } catch (err) {
    console.error('API like error:', err);
    res.status(500).json({ success: false, error: 'Greška pri lajkovanju.' });
  }
});


module.exports = router;
