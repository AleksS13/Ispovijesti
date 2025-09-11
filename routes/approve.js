// routes/approve.js
const express = require('express');
const router = express.Router();
const { pool, query } = require('../db');
const { limitApprove } = require('../middleware/limits');

/** Helper: identitet za "approve" */
function getApprover(req) {
  if (req.session?.user?.id) {
    return { userId: Number(req.session.user.id), sessionTokenHash: null, weight: 3 };
  }
  return { userId: null, sessionTokenHash: req.sessionID, weight: 1 };
}

/** GET /approve – sljedeća neodobrena ispovijest za ovog usera/sesiju */
router.get('/approve', limitApprove, async (req, res) => {
  const { userId, sessionTokenHash } = getApprover(req);

  try {
    const { rows: pick } = await query(
      `
      SELECT c.id, c.text, c.created_at
      FROM confessions c
      WHERE c.status IN ('waiting','rejected_ai')
        AND NOT EXISTS (
          SELECT 1 FROM approvals a
          WHERE a.confession_id = c.id
            AND (
                  ($1::bigint IS NOT NULL AND a.user_id = $1::bigint)
               OR ($2::text   IS NOT NULL AND a.session_token_hash = $2::text)
                )
        )
      ORDER BY c.created_at ASC
      LIMIT 1
      `,
      [userId, sessionTokenHash]
    );

    const confession = pick[0] || null;

    return res.render('approve', {
      title: 'Odobravanje',
      currentUser: req.session.user || null,
      confession,
    });
  } catch (err) {
    console.error('approve GET error', err);
    return res.status(500).send('Greška pri učitavanju odobravanja.');
  }
});

/** POST /approve/:id/yes – evidentiraj odobrenje i (ako treba) objavi */
router.post('/approve/:id/yes', limitApprove, async (req, res) => {
  const confessionId = Number(req.params.id);
  if (!Number.isInteger(confessionId)) {
    return res.status(400).send('Neispravan ID ispovijesti.');
  }

  const { userId, sessionTokenHash, weight } = getApprover(req);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO approvals (confession_id, user_id, session_token_hash, weight)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [confessionId, userId, sessionTokenHash, weight]
    );

    const { rows: sc } = await client.query(
      `SELECT COALESCE(SUM(weight),0)::int AS score
       FROM approvals WHERE confession_id = $1`,
      [confessionId]
    );
    const score = sc[0].score;

    if (score >= 10) {
      await client.query(
        `UPDATE confessions
         SET status = 'published', published_at = NOW()
         WHERE id = $1 AND status IN ('waiting','rejected_ai')`,
        [confessionId]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('approve POST yes error', err);
    return res.status(500).send('Greška pri odobravanju.');
  } finally {
    client.release();
  }

  return res.redirect('/approve');
});

/** POST /approve/:id/skip – preskoči bez akcije */
router.post('/approve/:id/skip', limitApprove, (req, res) => {
  return res.redirect('/approve');
});

module.exports = router;
