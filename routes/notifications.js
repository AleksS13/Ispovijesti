// routes/notifications.js
const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');

// GET /notifications — lista mojih notifikacija
router.get('/notifications', requireAuth, async (req, res) => {
  const userId = Number(req.session.user.id);
  try {
    const { rows } = await query(
      `SELECT id, user_id, confession_id, type, is_read, payload, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 200`,
      [userId]
    );

    // HTML (EJS)
    res.render('notifications', {
      title: 'Notifikacije',
      notifications: rows,
      currentUser: req.session.user
    });
  } catch (err) {
    console.error('notifications list error', err);
    res.status(500).send('Greška pri učitavanju notifikacija.');
  }
});

// POST /notifications/:id/read — označi jednu kao pročitanu
router.post('/notifications/:id/read', requireAuth, async (req, res) => {
  const userId = Number(req.session.user.id);
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).send('Neispravan ID.');

  try {
    await query(
      `UPDATE notifications
       SET is_read = TRUE
       WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    res.redirect('/notifications');
  } catch (err) {
    console.error('notifications mark-read error', err);
    res.status(500).send('Greška pri označavanju kao pročitano.');
  }
});

// POST /notifications/read-all — označi sve kao pročitane
router.post('/notifications/read-all', requireAuth, async (req, res) => {
  const userId = Number(req.session.user.id);
  try {
    await query(
      `UPDATE notifications
       SET is_read = TRUE
       WHERE user_id = $1 AND is_read = FALSE`,
      [userId]
    );
    res.redirect('/notifications');
  } catch (err) {
    console.error('notifications read-all error', err);
    res.status(500).send('Greška pri označavanju svih kao pročitane.');
  }
});

module.exports = router;
