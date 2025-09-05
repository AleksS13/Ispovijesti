// routes/confessions.js
const express = require('express');
const router = express.Router();

// koristimo i pool i query (pool za transakcije na istom konekšnu)
const { pool, query } = require('../db');
const { requireAuth } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

// helper: da prepoznamo da li klijent traži JSON (AJAX)
function wantsJSON(req) {
  return req.xhr || (req.get('accept') || '').includes('application/json');
}

/* -------------------------------------------------------------------------- */
/* Rate limit postavke (anti-spam)                                            */
/* -------------------------------------------------------------------------- */
function limitHandler(req, res /*, next */) {
  const msg = 'Previše zahtjeva. Pokušaj kasnije.';
  if (wantsJSON(req)) return res.status(429).json({ ok: false, error: msg });
  return res.status(429).send(msg);
}

// Nova ispovijest: max 5 u 10 min po IP
const newConfessionLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  handler: limitHandler,
  standardHeaders: true,
  legacyHeaders: false,
});

// Komentari: max 15 u 5 min po IP
const commentLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 15,
  handler: limitHandler,
  standardHeaders: true,
  legacyHeaders: false,
});

// “Lagane” radnje: like/approve/favorite — max 60 u 1 min po IP
const lightActionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  handler: limitHandler,
  standardHeaders: true,
  legacyHeaders: false,
});

/* -------------------------------------------------------------------------- */
/*  0) Forma za NOVU ispovijest (MORA ispred '/:id')                          */
/* -------------------------------------------------------------------------- */
router.get('/confessions/new', (req, res) => {
  res.render('confessions/new', {
    title: 'Nova ispovijest',
    currentUser: req.session.user || null
  });
});

/* -------------------------------------------------------------------------- */
/*  1) Kreiranje nove ispovijesti                                             */
/*  - Redirect vodi na /me/confessions da korisnik vidi svoj zapis            */
/* -------------------------------------------------------------------------- */
router.post('/confessions/new', newConfessionLimiter, async (req, res) => {
  const { text } = req.body;
  if (!text || text.trim().length < 5) {
    return res.status(400).send('Ispovijest je prekratka.');
  }

  const content = text.trim();
  // primitivan "AI" filter
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
      return res.redirect('/me/confessions');
    }

    return res.redirect('/me/confessions');
  } catch (err) {
    console.error('confession insert error', err);
    return res.status(500).send('Greška pri unosu ispovijesti.');
  }
});

/* -------------------------------------------------------------------------- */
/*  2) Detalji ispovijesti + komentari                                        */
/*  - SELECT vraća like_count, comment_count, favorite_count za UI            */
/* -------------------------------------------------------------------------- */
router.get('/confessions/:id', async (req, res) => {
  const confessionId = Number(req.params.id);
  try {
    const { rows: confessionRows } = await query(
      `SELECT c.id, c.text, c.status, c.created_at, c.published_at,
              (SELECT COUNT(*)::int FROM likes     l  WHERE l.confession_id  = c.id) AS like_count,
              (SELECT COUNT(*)::int FROM comments  cm WHERE cm.confession_id = c.id) AS comment_count,
              (SELECT COUNT(*)::int FROM favorites f  WHERE f.confession_id  = c.id) AS favorite_count
       FROM confessions c
       WHERE c.id = $1`,
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

    return res.render('confessions/detail', {
      title: 'Ispovijest',
      currentUser: req.session.user || null,
      confession,
      comments: commentRows
    });
  } catch (err) {
    console.error('confession detail error', err);
    return res.status(500).send('Greška na serveru.');
  }
});

/* -------------------------------------------------------------------------- */
/*  3) Dodavanje komentara (samo registrovani)                                */
/*  - Notifikacije favoritima (castovi)                                       */
/*  - (Opcionalno) notifikacija AUTORU (castovi + napomena za CHECK)          */
/* -------------------------------------------------------------------------- */
router.post('/confessions/:id/comment', requireAuth, commentLimiter, async (req, res) => {
  const confessionId = Number(req.params.id);
  const { content } = req.body;
  if (!content || content.trim().length < 2) {
    return res.status(400).send('Komentar je prekratak.');
  }

  try {
    const userId = Number(req.session.user.id);
    const text = content.trim();

    // 1) upiši komentar
    await query(
      `INSERT INTO comments (confession_id, user_id, session_token_hash, content)
       VALUES ($1::bigint, $2::bigint, NULL, $3::text)`,
      [confessionId, userId, text]
    );

    // 2) notifikacije favoritima (sa eksplicitnim kastovima)
    await query(
      `INSERT INTO notifications (user_id, confession_id, type, is_read, payload)
       SELECT f.user_id, $1::bigint, 'comment_on_favorite', FALSE,
              jsonb_build_object(
                'by_user_id', $2::bigint,
                'snippet', substr($3::text, 1, 120),
                'at', to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SSOF')
              )
       FROM favorites f
       WHERE f.confession_id = $1::bigint
         AND f.user_id <> $2::bigint`,
      [confessionId, userId, text]
    );

    // 3) (OPCIONALNO) notifikacija AUTORU ispovijesti
    //    ⚠️ Ako želiš i ovo, proširi CHECK:
    //    ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
    //    ALTER TABLE notifications
    //      ADD CONSTRAINT notifications_type_check
    //      CHECK (type IN (
    //        'comment_on_favorite','approve_on_favorite','like_on_favorite',
    //        'comment_on_confession','like_on_confession'
    //      ));
    try {
      await query(
        `INSERT INTO notifications (user_id, confession_id, type, is_read, payload)
         SELECT c.user_id, $1::bigint, 'comment_on_confession', FALSE,
                jsonb_build_object(
                  'by_user_id', $2::bigint,
                  'snippet', substr($3::text, 1, 120),
                  'at', to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SSOF')
                )
         FROM confessions c
         WHERE c.id = $1::bigint
           AND c.user_id IS NOT NULL
           AND c.user_id <> $2::bigint`,
        [confessionId, userId, text]
      );
    } catch (e) {
      console.error('notif comment->author error (ignored):', e);
    }

    return res.redirect(`/confessions/${confessionId}`);
  } catch (err) {
    console.error('comment insert error', err);
    return res.status(500).send('Greška pri unosu komentara.');
  }
});

/* -------------------------------------------------------------------------- */
/*  4) Lajkovanje (samo registrovani)                                         */
/*  - PRAVA transakcija (client = pool.connect())                             */
/*  - Notifikacije poslije COMMIT-a (best-effort)                             */
/* -------------------------------------------------------------------------- */
router.post('/confessions/:id/like', requireAuth, lightActionLimiter, async (req, res) => {
  const confessionId = Number(req.params.id);
  const userId = Number(req.session.user?.id);

  if (!Number.isInteger(confessionId) || !Number.isInteger(userId)) {
    const msg = 'Bad ids: confessionId/userId nisu cijeli brojevi';
    return wantsJSON(req)
      ? res.status(400).json({ ok: false, error: msg })
      : res.status(400).send(msg);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Idempotentni toggle
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
    const toggle = await client.query(toggleSql, [userId, confessionId]);
    const liked = toggle.rowCount > 0;

    // Trenutni count nakon toggla
    const { rows } = await client.query(
      'SELECT COUNT(*)::int AS count FROM likes WHERE confession_id = $1::bigint',
      [confessionId]
    );
    const count = rows[0].count;

    await client.query('COMMIT');

    // Notifikacije poslije COMMIT-a (best-effort)
    try {
      // favoritima
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

      // (OPCIONALNO) notifikacija AUTORU za lajk — zahtijeva proširen CHECK
      try {
        await query(
          `INSERT INTO notifications (user_id, confession_id, type, is_read, payload)
           SELECT c.user_id, $1::bigint, 'like_on_confession', FALSE,
                  jsonb_build_object(
                    'by_user_id', $2::bigint,
                    'at', to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SSOF')
                  )
           FROM confessions c
           WHERE c.id = $1::bigint
             AND c.user_id IS NOT NULL
             AND c.user_id <> $2::bigint`,
          [confessionId, userId]
        );
      } catch (e) {
        console.error('notif like->author error (ignored):', e);
      }
    } catch (e) {
      console.error('notif like error (ignored):', e);
    }

    return wantsJSON(req)
      ? res.json({ ok: true, liked, count })
      : res.redirect('back');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('like error', err);
    return wantsJSON(req)
      ? res.status(500).json({ ok: false, error: 'Greška pri lajkovanju.' })
      : res.status(500).send('Greška pri lajkovanju.');
  } finally {
    client.release();
  }
});

/* -------------------------------------------------------------------------- */
/*  5) Odobravanje (approve)                                                  */
/*  - PRAVA transakcija                                                       */
/*  - Notifikacije poslije COMMIT-a (best-effort)                             */
/*  - Objavi kad score >= 10 (waiting/rejected_ai -> published)               */
/* -------------------------------------------------------------------------- */
router.post('/confessions/:id/approve', lightActionLimiter, async (req, res) => {
  const confessionId = Number(req.params.id);
  if (!Number.isInteger(confessionId)) {
    return wantsJSON(req)
      ? res.status(400).json({ ok: false, error: 'Bad confession id' })
      : res.status(400).send('Bad confession id');
  }

  let userId = null;
  let sessionTokenHash = null;
  let weight = 1;
  if (req.session.user) { userId = Number(req.session.user.id); weight = 3; }
  else sessionTokenHash = req.sessionID;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO approvals (confession_id, user_id, session_token_hash, weight)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [confessionId, userId, sessionTokenHash, weight]
    );

    const { rows: scoreRows } = await client.query(
      `SELECT COALESCE(SUM(weight),0)::int AS score
       FROM approvals WHERE confession_id = $1`,
      [confessionId]
    );
    const score = scoreRows[0].score;

    if (score >= 10) {
      await client.query(
        `UPDATE confessions
         SET status = 'published', published_at = NOW()
         WHERE id = $1 AND status IN ('waiting','rejected_ai')`,
        [confessionId]
      );
    }

    const { rows: st } = await client.query(
      `SELECT status FROM confessions WHERE id = $1`,
      [confessionId]
    );

    await client.query('COMMIT');

    // Notifikacije favoritima (best-effort)
    try {
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
    } catch (e) {
      console.error('notif approve error (ignored):', e);
    }

    return wantsJSON(req)
      ? res.json({ ok: true, approved: true, score, status: st[0]?.status || 'unknown' })
      : res.redirect('back');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('approve error', err);
    return wantsJSON(req)
      ? res.status(500).json({ ok: false, error: 'Greška pri odobravanju.' })
      : res.status(500).send('Greška pri odobravanju.');
  } finally {
    client.release();
  }
});

/* -------------------------------------------------------------------------- */
/*  6) Favoriti                                                               */
/* -------------------------------------------------------------------------- */
router.post('/confessions/:id/favorite', requireAuth, lightActionLimiter, async (req, res) => {
  const confessionId = Number(req.params.id);
  const userId = Number(req.session.user.id);
  try {
    await query(
      `INSERT INTO favorites (user_id, confession_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [userId, confessionId]
    );
    return res.redirect('back');
  } catch (err) {
    console.error('favorite error', err);
    return res.status(500).send('Greška pri dodavanju u favorite.');
  }
});

router.post('/confessions/:id/unfavorite', requireAuth, lightActionLimiter, async (req, res) => {
  const confessionId = Number(req.params.id);
  const userId = Number(req.session.user.id);
  try {
    await query(
      `DELETE FROM favorites WHERE user_id = $1 AND confession_id = $2`,
      [userId, confessionId]
    );
    return res.redirect('back');
  } catch (err) {
    console.error('unfavorite error', err);
    return res.status(500).send('Greška pri uklanjanju iz favorita.');
  }
});

/* -------------------------------------------------------------------------- */
/*  7) Lista MOJIH favorita                                                   */
/* -------------------------------------------------------------------------- */
router.get('/favorites', requireAuth, async (req, res) => {
  const userId = Number(req.session.user.id);
  try {
    const { rows } = await query(
      `SELECT c.id, c.text,
              (SELECT COUNT(*)::int FROM likes l WHERE l.confession_id = c.id) AS like_count,
              (SELECT COUNT(*)::int FROM comments cm WHERE cm.confession_id = c.id) AS comment_count,
              (SELECT COUNT(*)::int FROM favorites ff WHERE ff.confession_id = c.id) AS favorite_count,
              f.created_at AS fav_since
       FROM favorites f
       JOIN confessions c ON c.id = f.confession_id
       WHERE f.user_id = $1
       ORDER BY f.created_at DESC
       LIMIT 100`,
      [userId]
    );

    return res.render('favorites', {
      title: 'Moji favoriti',
      currentUser: req.session.user,
      confessions: rows
    });
  } catch (err) {
    console.error('favorites list error', err);
    return res.status(500).send('Greška pri učitavanju favorita.');
  }
});

module.exports = router;
