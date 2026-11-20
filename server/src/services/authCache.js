const { createCache } = require('./memoCache');

/**
 * Who is signed in: { user, employee } as JSON text per user id, kept for a
 * few seconds (AUTH_CACHE_MS, default 15 s; 0 turns it off). Cleared by the
 * User and Employee models on every write, so a new password, a turned-off
 * login or a new role is seen by the very next request.
 */
const ttlMs = Number(process.env.AUTH_CACHE_MS ?? 15000);
module.exports = createCache({ ttlMs, max: 5000 });
