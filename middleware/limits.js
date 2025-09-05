// middleware/limits.js
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// Helper za kreiranje limitera
const makeLimiter = ({ windowMs, max, message }) =>
  rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7', // RateLimit-* headere
    legacyHeaders: false,

    // ✅ SIGURNO za IPv6: koristimo ipKeyGenerator(req)
    keyGenerator: (req, res) => {
      const ipPart = ipKeyGenerator(req); // kanonikalizovan IP (IPv4/IPv6)
      const userPart = req.session?.user?.id
        ? `u:${req.session.user.id}`
        : `s:${req.sessionID || 'nosess'}`;
      return `${ipPart}|${userPart}`;
    },

    // Fino poruke za JSON/HTML
    message: (req, res) => {
      const wantsJson = (req.get('accept') || '').includes('application/json');
      const msg = message || 'Previše zahtjeva. Pokušajte kasnije.';
      return wantsJson ? { ok: false, error: msg } : msg;
    },
  });

// 🎯 Granice (možeš ih kasnije korigovati po želji)
const limitNewConfession = makeLimiter({
  windowMs: 10 * 60 * 1000, // 10 min
  max: 5,
  message: 'Previše novih ispovijesti. Pokušajte kasnije.',
});

const limitComment = makeLimiter({
  windowMs: 10 * 60 * 1000,
  max: 8,
  message: 'Previše komentara u kratkom vremenu.',
});

const limitLike = makeLimiter({
  windowMs: 10 * 60 * 1000,
  max: 60,
  message: 'Previše akcija lajka. Usporite malo 🙂',
});

const limitApprove = makeLimiter({
  windowMs: 10 * 60 * 1000,
  max: 60,
  message: 'Previše odobravanja u kratkom vremenu.',
});

module.exports = {
  limitNewConfession,
  limitComment,
  limitLike,
  limitApprove,
};
