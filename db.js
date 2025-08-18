const { Pool } = require('pg');

// Kreiramo pool koristeći connection string iz .env
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('connect', () => {
  console.log('✅ PostgreSQL connected');
});

pool.on('error', (err) => {
  console.error('❌ PG Pool error', err);
});

// Export da ostatak app koristi .query
module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
};
