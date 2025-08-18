const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { requireAdmin } = require('../middleware/auth');

// Redirect na waiting tab
router.get('/admin', requireAdmin, (req, res) => {
  res.redirect('/admin/confessions?status=waiting');
});

// Lista ispovijesti po statusu (waiting ili rejected_ai)
router.get('/admin/confessions', requireAdmin, async (req, res) => {
  const status = req.query.status || 'waiting';
  try {
    const { rows } = await query(
      `SELECT id, text, status, created_at
       FROM confessions
       WHERE status = $1
       ORDER BY created_at ASC`,
      [status]
    );

    res.render('admin/confessions', {
      title: 'Admin - Ispovijesti',
      confessions: rows,
      activeStatus: status
    });
  } catch (err) {
    console.error('admin list error', err);
    res.status(500).send('Greška pri učitavanju ispovijesti.');
  }
});

// Objavi ispovijest
router.post('/admin/confessions/:id/publish', requireAdmin, async (req, res) => {
  const confessionId = req.params.id;
  try {
    await query(
      `UPDATE confessions
       SET status = 'published', published_at = NOW()
       WHERE id = $1`,
      [confessionId]
    );
    res.redirect('back');
  } catch (err) {
    console.error('publish error', err);
    res.status(500).send('Greška pri objavi ispovijesti.');
  }
});

// Odbij ispovijest
router.post('/admin/confessions/:id/reject', requireAdmin, async (req, res) => {
  const confessionId = req.params.id;
  try {
    await query(
      `UPDATE confessions
       SET status = 'rejected'
       WHERE id = $1`,
      [confessionId]
    );
    res.redirect('back');
  } catch (err) {
    console.error('reject error', err);
    res.status(500).send('Greška pri odbijanju ispovijesti.');
  }
});

// Obriši ispovijest
router.post('/admin/confessions/:id/delete', requireAdmin, async (req, res) => {
  const confessionId = req.params.id;
  try {
    await query(`DELETE FROM confessions WHERE id = $1`, [confessionId]);
    res.redirect('back');
  } catch (err) {
    console.error('delete error', err);
    res.status(500).send('Greška pri brisanju ispovijesti.');
  }
});

module.exports = router;
