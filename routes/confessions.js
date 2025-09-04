// routes/confessions.js
const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');

// helper da prepoznamo da li klijent traži JSON (AJAX)
function wantsJSON(req) {
  return req.xhr || (req.get('accept') || '').includes('application/json');
}

// --- 0) Forma za NOVU ispovijest (MORA ispred '/:id') ---
router.get('/confessions/new', (req, res) => {
  res.render('confessions/new', {
    title: 'Nova ispovijest',
    currentUser: req.session.user || null
  });
});

// --- 1) Kreiranje nove ispovijesti ---
router.post('/confessions/new', async (req, res) => {
  const { text } = req.body;
  if (!text || text.trim().length < 5) {
    return res.status(400).send('Ispovijest je prekratka.');
  }

  const content = text.trim();
  const banned = [/idiot/i, /mrzim/i, /ubiti/i, /govno/i, /psihop/i];
  const isBad = banned.some(rx => rx.test(content));

  try {
    let status = 'waiting';
    let aiFlagged = false;
    if (isBad) { status = 'rejected_ai'; aiFlagged = true; }

    const { rows } = await query(
      `INSERT INTO confessions (text, status, ai_flagged, user_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [content, status, aiFlagged, req.session.user ? req.session.user.id : null]
    );
    const newId = rows[0].id;

    if (isBad) {
      await query(
        `INSERT INTO ai_moderations (confession_id, label, score, reasons)
         VALUES ($1, $2, $3, $4)`,
        [newId, 'offensive', 0.95, 'Fake AI: matched banned pattern']
      );
      return res.redirect('/admin/confessions?status=rejected_ai');
    }

    res.redirect('/feed/latest');
  } catch (err) {
    console.error('confession insert error', err);
    res.status(500).send('Greška pri unosu ispovijesti.');
  }
});

// --- 2) Detalji ispovijesti + komentari ---
router.get('/confessions/:id', async (req, res) => {
  const confessionId = Number(req.params.id);
  try {
    const { rows: confessionRows } = await query(
      `SELECT id, text, status, created_at, published_at
       FROM confessions
       WHERE id = $1`,
      [confessionId]
    );
    if (confessionRows.length === 0) {
      return res.status(404).send('Ispovijest ne postoji.');
    }
    const confession = confessionRows[0];

    const { rows: commentRows } = await query(
      `SELECT cm.id, cm.content, cm.created_at, u.email
       FROM comments cm
       LEFT JOIN users u ON cm.user_id = u.id
       WHERE cm.confession_id = $1
       ORDER BY cm.created_at ASC`,
      [confessionId]
    );

    res.render('confessions/detail', {
      title: 'Ispovijest',
      currentUser: req.session.user || null,
      confession,
      comments: commentRows
    });
  } catch (err) {
    console.error('confession detail error', err);
    res.status(500).send('Greška na serveru.');
  }
});

// --- 3) Dodavanje komentara (samo registrovani) ---
router.post('/confessions/:id/comment', requireAuth, async (req, res) => {
  const confessionId = Number(req.params.id);
  const { content } = req.body;
  if (!content || content.trim().length < 2) {
    return res.status(400).send('Komentar je prekratka.');
  }

  try {
    const userId = Number(req.session.user.id);

    await query(
      `INSERT INTO comments (confession_id, user_id, session_token_hash, content)
       VALUES ($1, $2, NULL, $3)`,
      [confessionId, userId, content.trim()]
    );

    await query(
      `INSERT INTO notifications (user_id, confession_id, type, is_read, payload)
       SELECT f.user_id, $1, 'comment_on_favorite', FALSE,
              jsonb_build_object(
                'by_user_id', $2,
                'snippet', substr($3, 1, 120),
                'at', to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SSOF')
              )
       FROM favorites f
       WHERE f.confession_id = $1
         AND f.user_id <> $2`,
      [confessionId, userId, content.trim()]
    );

    res.redirect(`/confessions/${confessionId}`);
  } catch (err) {
    console.error('comment insert error', err);
    res.status(500).send('Greška pri unosu komentara.');
  }
});

// --- 4) Lajkovanje (samo registrovani, JSON ili redirect) ---
router.post('/confessions/:id/like', requireAuth, async (req, res) => {
  const confessionId = parseInt(req.params.id, 10);
  const userId = parseInt(req.session.user?.id, 10);

  // brza validacija ulaza
  if (!Number.isInteger(confessionId) || !Number.isInteger(userId)) {
    const msg = 'Bad ids: confessionId/userId nisu cijeli brojevi';
    return wantsJSON(req) ? res.status(400).json({ ok: false, error: msg })
                          : res.status(400).send(msg);
  }

  try {
    await query('BEGIN');

    // ✅ Idempotentni toggle + eksplicitni kastovi
    const toggleSql = `
      WITH deleted AS (
        DELETE FROM likes
        WHERE user_id = $1::bigint AND confession_id = $2::bigint
        RETURNING 1
      )
      INSERT INTO likes (user_id, confession_id, session_token_hash)
      SELECT $1::bigint, $2::bigint, NULL::text
      WHERE NOT EXISTS (SELECT 1 FROM deleted)
      RETURNING 1;
    `;
    const toggle = await query(toggleSql, [userId, confessionId]);
    const liked = toggle.rowCount > 0;

    // COUNT sa kastom
    const { rows } = await query(
      'SELECT COUNT(*)::int AS count FROM likes WHERE confession_id = $1::bigint',
      [confessionId]
    );
    const count = rows[0].count;

    // Notifikacije (kastovi u WHERE i payload)
    await query(
      `INSERT INTO notifications (user_id, confession_id, type, is_read, payload)
       SELECT f.user_id, $1::bigint, 'like_on_favorite', FALSE,
              jsonb_build_object(
                'by_user_id', $2::bigint,
                'at', to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SSOF')
              )
       FROM favorites f
       WHERE f.confession_id = $1::bigint
         AND f.user_id <> $2::bigint`,
      [confessionId, userId]
    );

    await query('COMMIT');

    if (wantsJSON(req)) {
      return res.json({ ok: true, liked, count });
    }
    return res.redirect('back');
  } catch (err) {
    await query('ROLLBACK');
    console.error('like error', err);
    if (wantsJSON(req)) {
      return res.status(500).json({ ok: false, error: 'Greška pri lajkovanju.' });
    }
    return res.status(500).send('Greška pri lajkovanju.');
  }
});


// --- 5) Odobravanje (JSON ili redirect) ---
router.post('/confessions/:id/approve', async (req, res) => {
  const confessionId = Number(req.params.id);
  if (!Number.isInteger(confessionId)) {
    return wantsJSON(req)
      ? res.status(400).json({ ok: false, error: 'Bad confession id' })
      : res.status(400).send('Bad confession id');
  }

  try {
    let userId = null;
    let sessionTokenHash = null;
    let weight = 1;
    if (req.session.user) { userId = Number(req.session.user.id); weight = 3; }
    else sessionTokenHash = req.sessionID;

    await query('BEGIN');

    await query(
      `INSERT INTO approvals (confession_id, user_id, session_token_hash, weight)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [confessionId, userId, sessionTokenHash, weight]
    );

    await query(
      `INSERT INTO notifications (user_id, confession_id, type, is_read, payload)
       SELECT f.user_id, $1, 'approve_on_favorite', FALSE,
              jsonb_build_object(
                'by_user_id', $2,
                'weight', $3,
                'at', to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SSOF')
              )
       FROM favorites f
       WHERE f.confession_id = $1
         AND ($2::BIGINT IS NULL OR f.user_id <> $2)`,
      [confessionId, userId, weight]
    );

    const { rows } = await query(
      `SELECT COALESCE(SUM(weight),0)::int AS score
       FROM approvals WHERE confession_id = $1`,
      [confessionId]
    );
    const score = rows[0].score;

    if (score >= 10) {
      await query(
        `UPDATE confessions
         SET status = 'published', published_at = NOW()
         WHERE id = $1 AND status IN ('waiting','rejected_ai')`,
        [confessionId]
      );
    }

    // uzmi aktuelni status nakon eventualnog update-a
    const { rows: st } = await query(
      `SELECT status FROM confessions WHERE id = $1`,
      [confessionId]
    );

    await query('COMMIT');

    if (wantsJSON(req)) {
      return res.json({ ok: true, approved: true, score, status: st[0]?.status || 'unknown' });
    }
    return res.redirect('back');
  } catch (err) {
    await query('ROLLBACK');
    console.error('approve error', err);
    if (wantsJSON(req)) {
      return res.status(500).json({ ok: false, error: 'Greška pri odobravanju.' });
    }
    return res.status(500).send('Greška pri odobravanju.');
  }
});


// --- 6) Favoriti ---
router.post('/confessions/:id/favorite', requireAuth, async (req, res) => {
  const confessionId = Number(req.params.id);
  const userId = Number(req.session.user.id);
  try {
    await query(
      `INSERT INTO favorites (user_id, confession_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [userId, confessionId]
    );
    res.redirect('back');
  } catch (err) {
    console.error('favorite error', err);
    res.status(500).send('Greška pri dodavanju u favorite.');
  }
});

router.post('/confessions/:id/unfavorite', requireAuth, async (req, res) => {
  const confessionId = Number(req.params.id);
  const userId = Number(req.session.user.id);
  try {
    await query(
      `DELETE FROM favorites WHERE user_id = $1 AND confession_id = $2`,
      [userId, confessionId]
    );
    res.redirect('back');
  } catch (err) {
    console.error('unfavorite error', err);
    res.status(500).send('Greška pri uklanjanju iz favorita.');
  }
});

// --- 7) Lista MOJIH favorita ---
router.get('/favorites', requireAuth, async (req, res) => {
  const userId = Number(req.session.user.id);
  try {
    const { rows } = await query(
      `SELECT c.id, c.text,
              (SELECT COUNT(*)::int FROM likes l WHERE l.confession_id = c.id) AS like_count,
              (SELECT COUNT(*)::int FROM comments cm WHERE cm.confession_id = c.id) AS comment_count,
              f.created_at AS fav_since
       FROM favorites f
       JOIN confessions c ON c.id = f.confession_id
       WHERE f.user_id = $1
       ORDER BY f.created_at DESC
       LIMIT 100`,
      [userId]
    );

    res.render('favorites', {
      title: 'Moji favoriti',
      currentUser: req.session.user,
      confessions: rows
    });
  } catch (err) {
    console.error('favorites list error', err);
    res.status(500).send('Greška pri učitavanju favorita.');
  }
});

module.exports = router;
