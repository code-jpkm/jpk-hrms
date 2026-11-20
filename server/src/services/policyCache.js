const { createCache } = require('./memoCache');

/** Each company's attendance policy, kept for a minute; cleared when it is saved. */
module.exports = createCache({ ttlMs: Number(process.env.POLICY_CACHE_MS ?? 60000), max: 200 });
