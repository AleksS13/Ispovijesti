const express = require('express');
const router = express.Router();
const { query } = require('../db');

router.get('/home', async (req, res) => {
  try {
   const { rows } = await query(`
  SELECT c.id, c.text,
         (SELECT COUNT(*)::int FROM likes l WHERE l.confession_id = c.id) AS like_count,
         (SELECT COUNT(*)::int FROM comments cm WHERE cm.confession_id = c.id) AS comment_count,
         (SELECT COUNT(*)::int FROM favorites f WHERE f.confession_id = c.id) AS favorite_count
  FROM confessions c
  WHERE c.status = 'published'
  ORDER BY c.created_at DESC
  LIMIT 20
`);


    res.render('home', {
      title: 'Početna',
      confessions: rows,
      activeTab: 'latest'
    });
  } catch (err) {
    console.error('home route error', err);
    res.status(500).send('Greška na serveru.');
  }
});

module.exports = router;
