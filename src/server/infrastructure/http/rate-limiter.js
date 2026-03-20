const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 5;

export function createRateLimiter({
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  windowMs = DEFAULT_WINDOW_MS,
} = {}) {
  const attempts = new Map();

  function getClientKey(req) {
    const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
    return forwarded || req.socket?.remoteAddress || 'unknown';
  }

  function prune(key, now) {
    const entries = attempts.get(key);
    if (!entries) {
      return;
    }

    const cutoff = now - windowMs;
    while (entries.length > 0 && entries[0] <= cutoff) {
      entries.shift();
    }

    if (entries.length === 0) {
      attempts.delete(key);
    }
  }

  return {
    isAllowed(req) {
      const key = getClientKey(req);
      const now = Date.now();
      prune(key, now);

      const entries = attempts.get(key);
      return !entries || entries.length < maxAttempts;
    },

    record(req) {
      const key = getClientKey(req);
      const now = Date.now();

      if (!attempts.has(key)) {
        attempts.set(key, []);
      }

      attempts.get(key).push(now);
    },

    get size() {
      return attempts.size;
    },
  };
}
