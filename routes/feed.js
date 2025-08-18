const express = require('express');
const router = express.Router();
const { query } = require('../db');

// helper: renderuj home sa listom ispovijesti
function renderFeed(res, req, rows, activeTab) {
  res.render('home', {
    title: 'Početna',
    currentUser: req.session.user || null,
    confessions: rows,
    activeTab, // koji tab je aktivan
  });
}

// Popularne (zadnja 24h)
router.get('/feed/popular', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT c.id, c.text,
             COUNT(DISTINCT l.id) AS like_count,
             COUNT(DISTINCT cm.id) AS comment_count
      FROM confessions c
      LEFT JOIN likes l ON l.confession_id = c.id
        AND l.created_at >= NOW() - INTERVAL '24 hours'
      LEFT JOIN comments cm ON cm.confession_id = c.id
      WHERE c.status = 'published'
      GROUP BY c.id
      ORDER BY like_count DESC, c.created_at DESC
      LIMIT 20
    `);
    renderFeed(res, req, rows, 'popular');
  } catch (err) {
    console.error('popular feed error', err);
    res.status(500).send('Greška na serveru.');
  }
});

// Najbolje (sve vrijeme)
router.get('/feed/best', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT c.id, c.text,
             COUNT(DISTINCT l.id) AS like_count,
             COUNT(DISTINCT cm.id) AS comment_count
      FROM confessions c
      LEFT JOIN likes l ON l.confession_id = c.id
      LEFT JOIN comments cm ON cm.confession_id = c.id
      WHERE c.status = 'published'
      GROUP BY c.id
      ORDER BY like_count DESC, c.created_at DESC
      LIMIT 20
    `);
    renderFeed(res, req, rows, 'best');
  } catch (err) {
    console.error('best feed error', err);
    res.status(500).send('Greška na serveru.');
  }
});

// Najnovije
router.get('/feed/latest', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT c.id, c.text,
             (SELECT COUNT(*) FROM likes l WHERE l.confession_id = c.id) AS like_count,
             (SELECT COUNT(*) FROM comments cm WHERE cm.confession_id = c.id) AS comment_count
      FROM confessions c
      WHERE c.status = 'published'
      ORDER BY c.created_at DESC
      LIMIT 20
    `);
    renderFeed(res, req, rows, 'latest');
  } catch (err) {
    console.error('latest feed error', err);
    res.status(500).send('Greška na serveru.');
  }
});

// Random
router.get('/feed/random', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT c.id, c.text,
             (SELECT COUNT(*) FROM likes l WHERE l.confession_id = c.id) AS like_count,
             (SELECT COUNT(*) FROM comments cm WHERE cm.confession_id = c.id) AS comment_count
      FROM confessions c
      WHERE c.status = 'published'
      ORDER BY random()
      LIMIT 20
    `);
    renderFeed(res, req, rows, 'random');
  } catch (err) {
    console.error('random feed error', err);
    res.status(500).send('Greška na serveru.');
  }
});

module.exports = router;
