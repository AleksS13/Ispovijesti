const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { requireAdmin } = require('../middleware/auth');

// Redirect na waiting tab
router.get('/admin', requireAdmin, (req, res) => {
  res.redirect('/admin/confessions?status=waiting');
});

// Admin dashboard
router.get('/admin/dashboard', requireAdmin, async (req, res) => {
  try {
    const stats = {};

    // broj korisnika
    const { rows: userCount } = await query(`SELECT COUNT(*) FROM users`);
    stats.users = parseInt(userCount[0].count, 10);

    // broj ispovijesti (ukupno i po statusima)
    const { rows: confTotal } = await query(`SELECT COUNT(*) FROM confessions`);
    stats.confessions_total = parseInt(confTotal[0].count, 10);

    const { rows: confByStatus } = await query(`
      SELECT status, COUNT(*) 
      FROM confessions 
      GROUP BY status
    `);
    stats.confessions_by_status = confByStatus;

    // broj komentara
    const { rows: commentsCount } = await query(`SELECT COUNT(*) FROM comments`);
    stats.comments = parseInt(commentsCount[0].count, 10);

    // broj lajkova
    const { rows: likesCount } = await query(`SELECT COUNT(*) FROM likes`);
    stats.likes = parseInt(likesCount[0].count, 10);

    // broj favorita
    const { rows: favCount } = await query(`SELECT COUNT(*) FROM favorites`);
    stats.favorites = parseInt(favCount[0].count, 10);

    res.render('admin/dashboard', {
      title: 'Admin – Dashboard',
      stats,
      currentUser: req.session.user
    });
  } catch (err) {
    console.error('dashboard error', err);
    res.status(500).send('Greška pri učitavanju dashboarda.');
  }
});


// Lista ispovijesti po statusu
router.get('/admin/confessions', requireAdmin, async (req, res) => {
  const status = req.query.status || 'waiting';

  try {
    const { rows } = await query(
      `SELECT id, text, status, created_at, published_at
       FROM confessions
       WHERE status = $1
       ORDER BY created_at DESC`,
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
