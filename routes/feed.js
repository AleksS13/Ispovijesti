// routes/feed.js
const express = require('express');
const router = express.Router();
const { query } = require('../db');

// Helper za render
async function renderFeed(res, tab, sql, params = []) {
  try {
    const { rows } = await query(sql, params);
    res.render('feed', {
      title: 'Feed',
      currentUser: res.locals.currentUser,
      confessions: rows,
      activeTab: tab
    });
  } catch (err) {
    console.error('feed error', err);
    res.status(500).send('Greška pri učitavanju feeda.');
  }
}

// Najnovije
router.get('/feed/latest', async (req, res) => {
  await renderFeed(res, 'latest',
    `SELECT c.id, c.text, c.created_at,
            (SELECT COUNT(*) FROM likes l WHERE l.confession_id = c.id) AS like_count,
            (SELECT COUNT(*) FROM comments cm WHERE cm.confession_id = c.id) AS comment_count
     FROM confessions c
     WHERE c.status = 'published'
     ORDER BY c.created_at DESC
     LIMIT 50`);
});

// Popularne (24h)
router.get('/feed/popular', async (req, res) => {
  await renderFeed(res, 'popular',
    `SELECT c.id, c.text, c.created_at,
            (SELECT COUNT(*) FROM likes l WHERE l.confession_id = c.id AND l.created_at > NOW() - interval '24 hours') AS like_count,
            (SELECT COUNT(*) FROM comments cm WHERE cm.confession_id = c.id) AS comment_count
     FROM confessions c
     WHERE c.status = 'published'
     ORDER BY like_count DESC NULLS LAST
     LIMIT 50`);
});

// Najbolje (ukupno)
router.get('/feed/best', async (req, res) => {
  await renderFeed(res, 'best',
    `SELECT c.id, c.text, c.created_at,
            (SELECT COUNT(*) FROM likes l WHERE l.confession_id = c.id) AS like_count,
            (SELECT COUNT(*) FROM comments cm WHERE cm.confession_id = c.id) AS comment_count
     FROM confessions c
     WHERE c.status = 'published'
     ORDER BY like_count DESC
     LIMIT 50`);
});

module.exports = router;
