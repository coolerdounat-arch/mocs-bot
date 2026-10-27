const { createCache } = require('../utils/cache');

const ROBLOX_REQUEST_TIMEOUT_MS = 10_000;
const usernameCache = createCache('roblox-users-by-name', { ttlMs: 5 * 60_000, maxEntries: 1000, cacheIf: (value) => value !== null });
const userByIdCache = createCache('roblox-users-by-id', { ttlMs: 5 * 60_000, maxEntries: 1000 });
const avatarCache = createCache('roblox-avatars', { ttlMs: 10 * 60_000, maxEntries: 1000 });
const usernameHistoryCache = createCache('roblox-username-history', { ttlMs: 30 * 60_000, maxEntries: 500 });

const ROBLOX_RETRY_STATUSES = new Set([429, 502, 503, 504]);
const ROBLOX_MAX_ATTEMPTS = 3;
const ROBLOX_MAX_RETRY_DELAY_MS = 5_000;

function getRetryDelayMs(response, attempt) {
  const retryAfterSeconds = Number(response.headers.get('retry-after'));
  const delay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
    ? retryAfterSeconds * 1000
    : 1000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
  return Math.min(delay, ROBLOX_MAX_RETRY_DELAY_MS);
}

async function fetchRoblox(url, options = {}, { maxAttempts = ROBLOX_MAX_ATTEMPTS, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(ROBLOX_REQUEST_TIMEOUT_MS) });
    if (!ROBLOX_RETRY_STATUSES.has(response.status) || attempt >= maxAttempts) return response;
    await response.body?.cancel();
    await sleep(getRetryDelayMs(response, attempt));
  }
}

function getFallbackHeadshotUrl(userId) {
  return `https://www.roblox.com/headshot-thumbnail/image?userId=${userId}&width=150&height=150&format=png`;
}
function getRobloxUser(username) {
  return usernameCache.wrap(String(username ?? '').trim().toLowerCase(), () => loadRobloxUser(username));
}

async function loadRobloxUser(username) {
  const res = await fetchRoblox('https://users.roblox.com/v1/usernames/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
  });

  if (!res.ok) {
    throw new Error(`Roblox username lookup failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  if (!data.data || data.data.length === 0) return null;
  return data.data[0];
}

function getAvatarHeadshotUrl(userId) {
  return avatarCache.wrap(String(userId), () => loadAvatarHeadshotUrl(userId));
}

async function loadAvatarHeadshotUrl(userId) {
  const url =
    `https://thumbnails.roblox.com/v1/users/avatar-headshot` +
    `?userIds=${userId}&size=150x150&format=Png&isCircular=false`;

  const res = await fetchRoblox(url);
  if (!res.ok) return getFallbackHeadshotUrl(userId);

  const data = await res.json();
  const entry = data.data && data.data[0];
  if (!entry || entry.state !== 'Completed' || !entry.imageUrl) return getFallbackHeadshotUrl(userId);
  return entry.imageUrl;
}

function getRobloxUserById(userId) {
  return userByIdCache.wrap(String(userId), () => loadRobloxUserById(userId));
}

async function loadRobloxUserById(userId) {
  const res = await fetchRoblox(`https://users.roblox.com/v1/users/${userId}`);
  if (!res.ok) {
    throw new Error(`Roblox user-by-id lookup failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return data;
}

function getUsernameHistory(userId) {
  return usernameHistoryCache.wrap(String(userId), () => loadUsernameHistory(userId));
}

async function loadUsernameHistory(userId) {
  const names = [];
  let cursor = null;

  for (let page = 0; page < 10; page += 1) {
    const url = new URL(`https://users.roblox.com/v1/users/${userId}/username-history`);
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('cursor', cursor);

    const res = await fetchRoblox(url);
    if (!res.ok) {
      throw new Error(`Roblox username history lookup failed: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    if (!Array.isArray(data.data)) throw new Error('Roblox username history response was incomplete.');
    const items = data.data;
    for (const item of items) {
      const name = String(item.name ?? item.username ?? item.Username ?? '').trim();
      if (name) names.push(name);
    }

    cursor = data.nextPageCursor || null;
    if (!cursor) break;
  }

  if (cursor) throw new Error('Roblox username history exceeded the 1,000-entry verification limit.');

  return [...new Set(names)];
}

module.exports = { fetchRoblox, getRobloxUser, getAvatarHeadshotUrl, getRobloxUserById, getUsernameHistory };
