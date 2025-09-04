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

// Lista ispovijesti po statusu (sa paginacijom)
router.get('/admin/confessions', requireAdmin, async (req, res) => {
  const allowed = new Set(['waiting', 'rejected_ai', 'rejected', 'published']);
  const status = allowed.has(req.query.status) ? req.query.status : 'waiting';

  const page = Math.max(parseInt(req.query.page || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 5), 100);
  const offset = (page - 1) * limit;

  try {
    // ukupno za taj status
    const { rows: countRows } = await query(
      `SELECT COUNT(*)::int AS total
       FROM confessions
       WHERE status = $1`,
      [status]
    );
    const total = countRows[0].total || 0;
    const totalPages = Math.max(Math.ceil(total / limit), 1);

    // stranica
    const { rows } = await query(
      `SELECT id, text, status, created_at, published_at
       FROM confessions
       WHERE status = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [status, limit, offset]
    );

    res.render('admin/confessions', {
      title: 'Admin - Ispovijesti',
      confessions: rows,
      activeStatus: status,
      page,
      limit,
      total,
      totalPages
    });
  } catch (err) {
    console.error('admin list error', err);
    res.status(500).send('Greška pri učitavanju ispovijesti.');
  }
});



// Objavi ispovijest (admin)
router.post('/admin/confessions/:id/publish', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).send('Neispravan ID.');
  }
  try {
    const { rowCount } = await query(
      `UPDATE confessions
       SET status = 'published', published_at = NOW()
       WHERE id = $1`,
      [id]
    );
    if (rowCount === 0) {
      return res.status(404).send('Ispovijest nije pronađena.');
    }
    return res.redirect('/admin/confessions?status=waiting');
  } catch (err) {
    console.error('publish error', err);
    return res.status(500).send('Greška pri objavi: ' + err.message);
  }
});

// Odbij ispovijest
router.post('/admin/confessions/:id/reject', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).send('Neispravan ID.');
  }
  try {
    const { rowCount } = await query(
      `UPDATE confessions
       SET status = 'rejected'
       WHERE id = $1`,
      [id]
    );
    if (rowCount === 0) {
      return res.status(404).send('Ispovijest nije pronađena.');
    }
    return res.redirect('/admin/confessions?status=waiting');
  } catch (err) {
    console.error('reject error', err);
    res.status(500).send('Greška pri odbijanju ispovijesti.');
  }
});

// Obriši ispovijest
router.post('/admin/confessions/:id/delete', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).send('Neispravan ID.');
  }
  try {
    const { rowCount } = await query(`DELETE FROM confessions WHERE id = $1`, [id]);
    if (rowCount === 0) {
      return res.status(404).send('Ispovijest nije pronađena.');
    }
    return res.redirect('/admin/confessions?status=waiting');
  } catch (err) {
    console.error('delete error', err);
    res.status(500).send('Greška pri brisanju ispovijesti.');
  }
});

module.exports = router;
