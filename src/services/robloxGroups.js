const { createCache } = require('../utils/cache');

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const ROBLOX_GROUP_TIMEOUT_MS = 10_000;
const userGroupRolesCache = createCache('roblox-user-group-roles', { ttlMs: 30_000, maxEntries: 1000 });
const groupRolesCache = createCache('roblox-group-roles', { ttlMs: 10 * 60_000, maxEntries: 100 });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options, { retries = 2, baseDelayMs = 400, label } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let delayMs = baseDelayMs * 2 ** attempt;
    try {
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(ROBLOX_GROUP_TIMEOUT_MS) });
      if (res.ok) return res;

      if (!RETRYABLE_STATUS.has(res.status) || attempt === retries) {
        throw new Error(`${label} failed: ${res.status} ${res.statusText}`);
      }
      lastErr = new Error(`${label} failed: ${res.status} ${res.statusText}`);
      if (res.status === 429) {
        const retryAfter = res.headers?.get?.('retry-after');
        if (retryAfter) {
          const retryAfterSeconds = Number(retryAfter);
          const retryAt = Number.isFinite(retryAfterSeconds)
            ? Date.now() + retryAfterSeconds * 1000
            : Date.parse(retryAfter);
          if (Number.isFinite(retryAt)) delayMs = Math.min(5_000, Math.max(0, retryAt - Date.now()));
        }
      }
    } catch (err) {
      lastErr = err;
      if (attempt === retries) throw lastErr;
    }

    const delay = delayMs;
    console.warn(`[robloxGroups] ${label} attempt ${attempt + 1} failed, retrying in ${delay}ms: ${lastErr.message}`);
    await sleep(delay);
  }
  throw lastErr;
}

function getUserGroupRoles(userId, { force = false } = {}) {
  return userGroupRolesCache.wrap(String(userId), () => loadUserGroupRoles(userId), { force });
}

async function loadUserGroupRoles(userId) {
  const res = await fetchWithRetry(
    `https://groups.roblox.com/v2/users/${userId}/groups/roles`,
    undefined,
    { label: 'Roblox group roles lookup' }
  );
  const data = await res.json();
  if (!Array.isArray(data?.data)) throw new Error('Roblox group roles response was incomplete.');
  if (data.data.some((entry) => (
    !Number.isFinite(Number(entry?.group?.id))
    || !entry?.role
    || typeof entry.role.name !== 'string'
    || !Number.isFinite(Number(entry.role.rank))
  ))) {
    throw new Error('Roblox group roles response contained incomplete membership data.');
  }
  return data.data;
}

function getGroupRoles(groupId) {
  return groupRolesCache.wrap(String(groupId), () => loadGroupRoles(groupId));
}

async function loadGroupRoles(groupId) {
  const res = await fetchWithRetry(
    `https://groups.roblox.com/v1/groups/${groupId}/roles`,
    undefined,
    { label: 'Roblox group roles (by group) lookup' }
  );
  const data = await res.json();
  const roles = data?.roles ?? data?.data;
  if (!Array.isArray(roles)) throw new Error('Roblox group roles response was incomplete.');
  return roles;
}

module.exports = { getUserGroupRoles, getGroupRoles };
