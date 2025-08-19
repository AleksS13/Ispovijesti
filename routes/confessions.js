// routes/confessions.js
const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');


// --- GET forma za novu ispovijest ---
router.get('/confessions/new', requireAuth, (req, res) => {
  res.render('confessions/new', { 
    title: 'Nova ispovijest',
    error: null 
  });
});


// --- 1) Nova ispovijest (sa fake AI moderacijom) ---
router.post('/confessions/new', async (req, res) => {
  const { text } = req.body;
  if (!text || text.trim().length < 5) {
    return res.status(400).send('Ispovijest je prekratka.');
  }

  const content = text.trim();

  // Fake AI moderacija: jednostavna “blacklist”
  const banned = [/idiot/i, /mrzim/i, /ubiti/i, /govno/i, /psihop/i];
  const isBad = banned.some(rx => rx.test(content));

  try {
    let status = 'waiting';
    let aiFlagged = false;
    if (isBad) { status = 'rejected_ai'; aiFlagged = true; }

    const { rows } = await query(
      `INSERT INTO confessions (text, status, ai_flagged)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [content, status, aiFlagged]
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
    console.error('confession insert + AI error', err);
    res.status(500).send('Greška pri unosu ispovijesti.');
  }
});

// --- 2) Detalji ispovijesti + komentari ---
router.get('/confessions/:id', async (req, res) => {
  const confessionId = req.params.id;
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

// --- 3) Dodavanje komentara + notifikacije favoritima ---
router.post('/confessions/:id/comment', async (req, res) => {
  const confessionId = req.params.id;
  const { content } = req.body;
  if (!content || content.trim().length < 2) {
    return res.status(400).send('Komentar je prekratak.');
  }

  try {
    let userId = null;
    let sessionTokenHash = null;
    if (req.session.user) userId = req.session.user.id;
    else sessionTokenHash = req.sessionID;

    await query(
      `INSERT INTO comments (confession_id, user_id, session_token_hash, content)
       VALUES ($1, $2, $3, $4)`,
      [confessionId, userId, sessionTokenHash, content.trim()]
    );

    // Notifikacije za sve koji imaju ovaj confession u favoritima (osim autora komentara)
    await query(
      `INSERT INTO notifications (user_id, confession_id, type, is_read, payload)
       SELECT f.user_id, $1, 'comment_on_favorite', FALSE,
              jsonb_build_object(
                'snippet', substr($2, 1, 120),
                'at', to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SSOF')
              )
       FROM favorites f
       WHERE f.confession_id = $1
         AND ($3::BIGINT IS NULL OR f.user_id <> $3)`,
      [confessionId, content.trim(), userId]
    );

    res.redirect(`/confessions/${confessionId}`);
  } catch (err) {
    console.error('comment insert error', err);
    res.status(500).send('Greška pri unosu komentara.');
  }
});

// --- 4) Lajkovanje ispovijesti ---
router.post('/confessions/:id/like', async (req, res) => {
  const confessionId = req.params.id;
  try {
    let userId = null;
    let sessionTokenHash = null;
    if (req.session.user) userId = req.session.user.id;
    else sessionTokenHash = req.sessionID;

    await query(
      `INSERT INTO likes (confession_id, user_id, session_token_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [confessionId, userId, sessionTokenHash]
    );

    res.redirect('back');
  } catch (err) {
    console.error('like error', err);
    res.status(500).send('Greška pri lajkovanju.');
  }
});

// --- 5) Odobravanje (bodovi) + auto publish >= 10 ---
router.post('/confessions/:id/approve', async (req, res) => {
  const confessionId = req.params.id;
  try {
    let userId = null;
    let sessionTokenHash = null;
    let weight = 1; // gost = 1
    if (req.session.user) { userId = req.session.user.id; weight = 3; }
    else sessionTokenHash = req.sessionID;

    await query(
      `INSERT INTO approvals (confession_id, user_id, session_token_hash, weight)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [confessionId, userId, sessionTokenHash, weight]
    );

    const { rows } = await query(
      `SELECT COALESCE(SUM(weight),0) AS score
       FROM approvals WHERE confession_id = $1`,
      [confessionId]
    );
    const score = parseInt(rows[0].score, 10);

    if (score >= 10) {
      await query(
        `UPDATE confessions
         SET status = 'published', published_at = NOW()
         WHERE id = $1 AND status IN ('waiting','rejected_ai')`,
        [confessionId]
      );
    }

    res.redirect('back');
  } catch (err) {
    console.error('approve error', err);
    res.status(500).send('Greška pri odobravanju.');
  }
});

// --- 6) Dodaj u favorite (samo registrovani) ---
router.post('/confessions/:id/favorite', requireAuth, async (req, res) => {
  const confessionId = req.params.id;
  const userId = req.session.user.id;
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

// --- 7) Ukloni iz favorita ---
router.post('/confessions/:id/unfavorite', requireAuth, async (req, res) => {
  const confessionId = req.params.id;
  const userId = req.session.user.id;
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

// --- 8) Moji favoriti (lista) ---
router.get('/favorites', requireAuth, async (req, res) => {
  const userId = req.session.user.id;
  try {
    const { rows } = await query(
      `SELECT c.id, c.text,
              (SELECT COUNT(*) FROM likes l WHERE l.confession_id = c.id) AS like_count,
              (SELECT COUNT(*) FROM comments cm WHERE cm.confession_id = c.id) AS comment_count,
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

// --- 9) Notifikacije (lista) ---
router.get('/notifications', requireAuth, async (req, res) => {
  const userId = req.session.user.id;
  try {
    const { rows } = await query(
      `SELECT id, confession_id, type, is_read, payload, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY is_read ASC, created_at DESC
       LIMIT 200`,
      [userId]
    );

    res.render('notifications', {
      title: 'Notifikacije',
      currentUser: req.session.user,
      notifications: rows
    });
  } catch (err) {
    console.error('notifications list error', err);
    res.status(500).send('Greška pri učitavanju notifikacija.');
  }
});

// --- 10) Označi pročitano ---
router.post('/notifications/:id/read', requireAuth, async (req, res) => {
  const userId = req.session.user.id;
  const notifId = req.params.id;
  try {
    await query(
      `UPDATE notifications SET is_read = TRUE
       WHERE id = $1 AND user_id = $2`,
      [notifId, userId]
    );
    res.redirect('back');
  } catch (err) {
    console.error('notification read error', err);
    res.status(500).send('Greška pri označavanju notifikacije.');
  }
});

// --- 11) Označi sve kao pročitano ---
router.post('/notifications/read-all', requireAuth, async (req, res) => {
  const userId = req.session.user.id;
  try {
    await query(
      `UPDATE notifications SET is_read = TRUE
       WHERE user_id = $1 AND is_read = FALSE`,
      [userId]
    );
    res.redirect('back');
  } catch (err) {
    console.error('notifications read-all error', err);
    res.status(500).send('Greška pri označavanju svih notifikacija.');
  }
});

module.exports = router;
