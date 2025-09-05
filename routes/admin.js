const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { requireAdmin } = require('../middleware/auth');

/* ----------------------------- Redirect na tab ----------------------------- */
router.get('/admin', requireAdmin, (req, res) => {
  res.redirect('/admin/confessions?status=waiting');
});

/* ------------------------------- Dashboard --------------------------------- */
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
  const status = req.query.status || 'waiting';

  const page  = Math.max(parseInt(req.query.page || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
  const offset = (page - 1) * limit;

  try {
    const totalRes = await query(
      `SELECT COUNT(*)::int AS count FROM confessions WHERE status = $1`,
      [status]
    );
    const total = totalRes.rows[0].count;                 // 👈 imamo total
    const totalPages = Math.max(Math.ceil(total / limit), 1);

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
      totalPages,
      limit,
      total                                       // 👈 dodajemo total
    });
  } catch (err) {
    console.error('admin list error', err);
    res.status(500).send('Greška pri učitavanju ispovijesti.');
  }
});



/* ------------------------- Objavi ispovijest (admin) ----------------------- */
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

/* ----------------------------- Odbij / Obriši ------------------------------ */
router.post('/admin/confessions/:id/reject', requireAdmin, async (req, res) => {
  const confessionId = Number(req.params.id);
  if (!Number.isInteger(confessionId)) return res.status(400).send('Neispravan ID.');
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

router.post('/admin/confessions/:id/delete', requireAdmin, async (req, res) => {
  const confessionId = Number(req.params.id);
  if (!Number.isInteger(confessionId)) return res.status(400).send('Neispravan ID.');
  try {
    await query(`DELETE FROM confessions WHERE id = $1`, [confessionId]);
    res.redirect('back');
  } catch (err) {
    console.error('delete error', err);
    res.status(500).send('Greška pri brisanju ispovijesti.');
  }
});

/* ============================================================================
 *                               KORISNICI (admin)
 * ==========================================================================*/

/** Lista korisnika (sa paginacijom) */
router.get('/admin/users', requireAdmin, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
    const offset = (page - 1) * limit;

    const totalRes = await query(`SELECT COUNT(*)::int AS count FROM users`);
    const total = totalRes.rows[0].count;
    const totalPages = Math.max(Math.ceil(total / limit), 1);

    const { rows: users } = await query(
      `SELECT u.id, u.email, u.role, u.is_active, u.blocked_until,
              (SELECT COUNT(*)::int FROM confessions c WHERE c.user_id = u.id) AS conf_count,
              (SELECT COUNT(*)::int FROM comments cm WHERE cm.user_id = u.id) AS comment_count
       FROM users u
       ORDER BY u.id DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    res.render('admin/users', {
      title: 'Admin – Korisnici',
      users,
      page,
      totalPages,
      limit
    });
  } catch (err) {
    console.error('admin users list error', err);
    res.status(500).send('Greška pri učitavanju korisnika.');
  }
});

/** Deaktiviraj korisnika */
router.post('/admin/users/:id/deactivate', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).send('Neispravan ID.');
  if (req.session.user.id === id) return res.status(400).send('Ne možeš deaktivirati samog sebe.');
  try {
    await query(`UPDATE users SET is_active = FALSE WHERE id = $1`, [id]);
    res.redirect('back');
  } catch (err) {
    console.error('deactivate user error', err);
    res.status(500).send('Greška pri deaktivaciji korisnika.');
  }
});

/** Aktiviraj korisnika */
router.post('/admin/users/:id/activate', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).send('Neispravan ID.');
  try {
    await query(`UPDATE users SET is_active = TRUE WHERE id = $1`, [id]);
    res.redirect('back');
  } catch (err) {
    console.error('activate user error', err);
    res.status(500).send('Greška pri aktivaciji korisnika.');
  }
});

/** Blokiraj korisnika na X dana (default 15) */
router.post('/admin/users/:id/block', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const days = Math.max(parseInt(req.body.days || '15', 10), 1); // 15 by default
  if (!Number.isInteger(id)) return res.status(400).send('Neispravan ID.');
  if (req.session.user.id === id) return res.status(400).send('Ne možeš blokirati samog sebe.');
  try {
    await query(
      `UPDATE users
       SET blocked_until = NOW() + ($2::int || ' days')::interval
       WHERE id = $1`,
      [id, days]
    );
    res.redirect('back');
  } catch (err) {
    console.error('block user error', err);
    res.status(500).send('Greška pri blokiranju korisnika.');
  }
});

/** Ukloni blokadu */
router.post('/admin/users/:id/unblock', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).send('Neispravan ID.');
  try {
    await query(`UPDATE users SET blocked_until = NULL WHERE id = $1`, [id]);
    res.redirect('back');
  } catch (err) {
    console.error('unblock user error', err);
    res.status(500).send('Greška pri uklanjanju blokade.');
  }
});

module.exports = router;
