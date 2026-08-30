export function createAgentToolRateLimiter(requestsPerMinute) {
  const limit = Math.max(1, Number.parseInt(requestsPerMinute, 10) || 120);
  const windows = new Map();
  let nextSweepAt = 0;
  return (key) => {
    const timestamp = Date.now();
    if (timestamp >= nextSweepAt) {
      for (const [windowKey, window] of windows) {
        if (timestamp >= window.resetAt) windows.delete(windowKey);
      }
      nextSweepAt = timestamp + 60_000;
    }
    let window = windows.get(key);
    if (!window || timestamp >= window.resetAt) {
      window = { count: 0, resetAt: timestamp + 60_000 };
      windows.set(key, window);
    }
    if (window.count >= limit) {
      const error = new Error('Agent tool request limit reached; retry after the current window');
      error.code = 'AGENT_RATE_LIMITED';
      error.retryAfterMs = Math.max(1, window.resetAt - timestamp);
      error.statusCode = 429;
      throw error;
    }
    window.count += 1;
  };
}
