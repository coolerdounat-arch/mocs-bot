const { createCache } = require('../utils/cache');

const windows = createCache('rate-limits', { ttlMs: 60_000, maxEntries: 20_000, clone: false });

function isLoopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function getClientAddress(request) {
  const remoteAddress = request.socket?.remoteAddress || '';
  if (!isLoopback(remoteAddress)) return remoteAddress || 'unknown';
  const forwarded = String(request.headers['x-forwarded-for'] || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return forwarded.at(-1) || remoteAddress;
}

function consumeRateLimit(bucket, request, { limit, windowMs = 60_000 }) {
  const key = `${bucket}:${getClientAddress(request)}`;
  const now = Date.now();
  let entry = windows.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    windows.set(key, entry, windowMs);
  }
  entry.count += 1;
  return {
    allowed: entry.count <= limit,
    retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
  };
}

function resetRateLimits() {
  return windows.clear();
}

module.exports = { consumeRateLimit, getClientAddress, resetRateLimits };
