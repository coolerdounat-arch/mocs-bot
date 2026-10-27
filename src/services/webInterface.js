const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const {
  getDatabase,
  getLinkedUser,
  getLinkedUsers,
  saveLinkedUser,
  removeLinkedUsers,
  getPrivilegedUserIds,
  isPrivilegedDiscordUser,
  addPrivilegedUserId,
  removePrivilegedUserId,
  isProtectedPrivilegedUserId,
} = require('./linkedUsers');
const { getMemberDashboard } = require('./memberDashboard');
const { getNumericConfigValue } = require('./configuration');
const { getUserGroupRoles } = require('./robloxGroups');
const { consumeRateLimit } = require('./rateLimiter');

const SESSION_COOKIE = 'discord_portal_session';
const OAUTH_STATE_COOKIE = 'discord_portal_oauth_state';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const STATE_TTL_MS = 10 * 60 * 1000;
const MAX_SESSIONS = 5000;
const MAX_OAUTH_STATES = 2000;
const DISCORD_REQUEST_TIMEOUT_MS = 10_000;
const STATE_PRUNE_INTERVAL_MS = 60_000;
let portalStateDatabase = null;
let lastStatePruneAt = 0;
const WEB_ROOT = path.join(__dirname, '..', 'web');
const MINISTRY_LOGO_PATH = path.join(__dirname, '..', 'data', 'ministry-logo.png');
const PORTAL_PATH = '/portal';
const RATE_LIMITS = {
  auth: { limit: 20 },
  'admin-write': { limit: 30 },
  api: { limit: 120 },
};

function send(response, status, contentType, body, extraHeaders = {}) {
  response.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' https://cdn.discordapp.com https://*.rbxcdn.com https://www.roblox.com; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    ...extraHeaders,
  });
  response.end(body);
}

function sendJson(response, status, value, extraHeaders = {}) {
  send(response, status, 'application/json; charset=utf-8', JSON.stringify(value), extraHeaders);
}

function getRequestProtocol(request) {
  const forwardedProto = String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  if (forwardedProto === 'http' || forwardedProto === 'https') return forwardedProto;
  if (request.socket.encrypted) return 'https';
  return String(process.env.DISCORD_OAUTH_REDIRECT_URI || '').startsWith('https://') ? 'https' : 'http';
}

function cookieOptions(request, maxAge, cookiePath = '/') {
  const secure = getRequestProtocol(request) === 'https';
  return `Path=${cookiePath}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function hashSessionId(sessionId) {
  return crypto.createHash('sha256').update(sessionId).digest('hex');
}

function getRateLimitBucket(request, pathname) {
  if (pathname.startsWith('/auth/')) return 'auth';
  if (pathname.startsWith('/api/admin/') && request.method !== 'GET') return 'admin-write';
  if (pathname.startsWith('/api/')) return 'api';
  return null;
}

function pruneExpiredState() {
  const now = Date.now();
  const database = getDatabase();
  if (portalStateDatabase !== database) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS portal_sessions (
        session_id TEXT PRIMARY KEY NOT NULL,
        user_json TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS portal_sessions_expiry ON portal_sessions (expires_at);
      CREATE TABLE IF NOT EXISTS portal_oauth_states (
        state TEXT PRIMARY KEY NOT NULL,
        return_path TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS portal_oauth_states_expiry ON portal_oauth_states (expires_at);
    `);
    portalStateDatabase = database;
    lastStatePruneAt = 0;
  }
  if (now - lastStatePruneAt < STATE_PRUNE_INTERVAL_MS) return;
  lastStatePruneAt = now;
  database.prepare('DELETE FROM portal_sessions WHERE expires_at <= ?').run(now);
  database.prepare('DELETE FROM portal_oauth_states WHERE expires_at <= ?').run(now);
}

function createOAuthState(state, returnPath, expiresAt) {
  const database = getDatabase();
  return database.transaction(() => {
    database.prepare('DELETE FROM portal_oauth_states WHERE expires_at <= ?').run(Date.now());
    const count = database.prepare('SELECT COUNT(*) AS count FROM portal_oauth_states').get().count;
    if (count >= MAX_OAUTH_STATES) return false;
    database.prepare('INSERT INTO portal_oauth_states (state, return_path, expires_at) VALUES (?, ?, ?)').run(state, returnPath, expiresAt);
    return true;
  })();
}

function consumeOAuthState(state) {
  const database = getDatabase();
  return database.transaction(() => {
    const row = database.prepare('SELECT return_path, expires_at FROM portal_oauth_states WHERE state = ?').get(state);
    database.prepare('DELETE FROM portal_oauth_states WHERE state = ?').run(state);
    return row ? { returnPath: row.return_path, expiresAt: row.expires_at } : null;
  })();
}

function createPortalSession(sessionId, user, expiresAt) {
  const database = getDatabase();
  return database.transaction(() => {
    database.prepare('DELETE FROM portal_sessions WHERE expires_at <= ?').run(Date.now());
    const count = database.prepare('SELECT COUNT(*) AS count FROM portal_sessions').get().count;
    if (count >= MAX_SESSIONS) throw new Error('Too many active portal sessions. Try again shortly.');
    database.prepare('INSERT INTO portal_sessions (session_id, user_json, expires_at) VALUES (?, ?, ?)').run(
      hashSessionId(sessionId),
      JSON.stringify(user),
      expiresAt,
    );
  })();
}

function getSession(request) {
  const sessionIds = String(request.headers.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${SESSION_COOKIE}=`))
    .map((part) => part.slice(SESSION_COOKIE.length + 1));
  if (!sessionIds.length) return null;
  const database = getDatabase();
  const findSession = database.prepare('SELECT user_json, expires_at FROM portal_sessions WHERE session_id = ?');
  const deleteSession = database.prepare('DELETE FROM portal_sessions WHERE session_id = ?');
  for (const sessionId of sessionIds) {
    if (!/^[a-f\d]{64}$/i.test(sessionId)) continue;
    const sessionKey = hashSessionId(sessionId);
    const row = findSession.get(sessionKey);
    if (row && row.expires_at > Date.now()) {
      return { sessionId, sessionKey, session: { user: JSON.parse(row.user_json), expiresAt: row.expires_at } };
    }
    if (row) deleteSession.run(sessionKey);
  }
  return null;
}

function getCookieValue(request, name) {
  const cookie = String(request.headers.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return cookie ? cookie.slice(name.length + 1) : '';
}

function oauthStateCookieOptions(request, value, maxAge) {
  const secure = getRequestProtocol(request) === 'https';
  return `${OAUTH_STATE_COOKIE}=${value}; Path=${PORTAL_PATH}/auth/discord/callback; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function isSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return false;
  try {
    const parsedOrigin = new URL(origin);
    const forwardedHost = String(request.headers['x-forwarded-host'] || request.headers.host || '').split(',')[0].trim();
    const protocol = getRequestProtocol(request);
    return parsedOrigin.host === forwardedHost && parsedOrigin.protocol === `${protocol}:`;
  } catch {
    return false;
  }
}

async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 16_384) throw new Error('Request body is too large.');
  }
  return JSON.parse(body || '{}');
}

async function fetchDiscordJson(url, options) {
  const result = await fetch(url, { ...options, signal: AbortSignal.timeout(DISCORD_REQUEST_TIMEOUT_MS) });
  if (!result.ok) throw new Error(`Discord API returned ${result.status}.`);
  return result.json();
}

function isPrivilegedUser(userId) {
  return isPrivilegedDiscordUser(userId);
}

async function isRobloxGroupMember(linkedUser) {
  const mocsGroupId = String(getNumericConfigValue('mocs_group_id', 10409578));
  const groupRoles = await getUserGroupRoles(linkedUser.robloxId);
  return groupRoles.some((entry) => String(entry?.group?.id ?? '') === mocsGroupId);
}

async function startDiscordLogin(request, response, requestUrl) {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const redirectUri = process.env.DISCORD_OAUTH_REDIRECT_URI;
  if (!clientId || !process.env.DISCORD_OAUTH_CLIENT_SECRET || !redirectUri) {
    send(response, 503, 'text/plain; charset=utf-8', 'Discord sign-in is not configured.');
    return;
  }

  const returnPath = requestUrl.searchParams.get('next') === `${PORTAL_PATH}/admin` ? `${PORTAL_PATH}/admin` : `${PORTAL_PATH}/`;
  const state = crypto.randomBytes(32).toString('hex');
  if (!createOAuthState(state, returnPath, Date.now() + STATE_TTL_MS)) {
    send(response, 503, 'text/plain; charset=utf-8', 'Too many sign-in requests are pending. Try again shortly.');
    return;
  }
  const authorizeUrl = new URL('https://discord.com/oauth2/authorize');
  authorizeUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify',
    state,
  }).toString();
  send(response, 302, 'text/plain; charset=utf-8', '', {
    Location: authorizeUrl.toString(),
    'Set-Cookie': oauthStateCookieOptions(request, state, STATE_TTL_MS / 1000),
  });
}

async function completeDiscordLogin(request, response, requestUrl, client) {
  const state = requestUrl.searchParams.get('state') || '';
  const stateData = consumeOAuthState(state);
  const stateCookie = getCookieValue(request, OAUTH_STATE_COOKIE);
  const clearStateCookie = oauthStateCookieOptions(request, '', 0);
  if (!stateData || stateData.expiresAt <= Date.now() || stateCookie !== state || requestUrl.searchParams.has('error')) {
    send(response, 302, 'text/plain; charset=utf-8', '', {
      Location: `${stateData?.returnPath || `${PORTAL_PATH}/`}?login=failed`,
      'Set-Cookie': clearStateCookie,
    });
    return;
  }

  try {
    const token = await fetchDiscordJson('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID || '',
        client_secret: process.env.DISCORD_OAUTH_CLIENT_SECRET || '',
        grant_type: 'authorization_code',
        code: requestUrl.searchParams.get('code') || '',
        redirect_uri: process.env.DISCORD_OAUTH_REDIRECT_URI || '',
      }),
    });
    const user = await fetchDiscordJson('https://discord.com/api/users/@me', {
      headers: { Authorization: `${token.token_type} ${token.access_token}` },
    });

    const sessionId = crypto.randomBytes(32).toString('hex');
    const sessionUser = {
      id: String(user.id),
      username: String(user.global_name || user.username || 'Discord member'),
      avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=96` : null,
    };
    createPortalSession(sessionId, sessionUser, Date.now() + SESSION_TTL_MS);
    send(response, 302, 'text/plain; charset=utf-8', '', {
      Location: stateData.returnPath,
      'Set-Cookie': [
        `${SESSION_COOKIE}=${sessionId}; ${cookieOptions(request, SESSION_TTL_MS / 1000)}`,
        `${SESSION_COOKIE}=; ${cookieOptions(request, 0, PORTAL_PATH)}`,
        clearStateCookie,
      ],
    });
    return;
  } catch (error) {
    console.error('Discord portal login failed:', error);
    send(response, 302, 'text/plain; charset=utf-8', '', {
      Location: `${stateData.returnPath}?login=failed`,
      'Set-Cookie': clearStateCookie,
    });
  }
}

function requireSession(request, response) {
  const authenticated = getSession(request);
  if (!authenticated) {
    sendJson(response, 401, { error: 'Sign in with Discord to continue.' });
    return null;
  }
  return authenticated;
}

async function handleAdminApi(request, response, requestUrl, authenticated) {
  const routePath = requestUrl.pathname.slice(PORTAL_PATH.length);
  if (!isPrivilegedUser(authenticated.session.user.id)) {
    sendJson(response, 403, { error: 'This page is restricted to privileged Discord users.' });
    return;
  }

  if (request.method === 'GET' && routePath === '/api/admin/privileged-users') {
    sendJson(response, 200, {
      users: getPrivilegedUserIds().map((discordId) => ({ discordId, protected: isProtectedPrivilegedUserId(discordId) })),
    });
    return;
  }

  if (request.method === 'POST' && routePath === '/api/admin/privileged-users') {
    if (!isSameOrigin(request)) {
      sendJson(response, 403, { error: 'Request origin was not accepted.' });
      return;
    }
    try {
      const input = await readJson(request);
      const discordId = String(input.discordId || '').trim();
      if (!/^\d{17,20}$/.test(discordId)) throw new Error('Enter a valid Discord user ID.');
      if (input.action === 'add') {
        const added = addPrivilegedUserId(discordId);
        sendJson(response, 200, { message: added ? 'Privileged user added.' : 'That Discord ID is already privileged.' });
        return;
      }
      if (input.action === 'remove' || input.action === 'delete') {
        if (isProtectedPrivilegedUserId(discordId)) throw new Error('The protected owner cannot be removed.');
        if (discordId === authenticated.session.user.id) throw new Error('You cannot remove your own privileged access.');
        const removed = removePrivilegedUserId(discordId);
        sendJson(response, removed ? 200 : 404, { message: removed ? 'Privileged user removed.' : 'That Discord ID is not privileged.' });
        return;
      }
      throw new Error('Choose add or remove.');
    } catch (error) {
      sendJson(response, 400, { error: error.message || 'The request could not be completed.' });
    }
    return;
  }

  if (request.method === 'GET' && routePath === '/api/admin/linked-users') {
    sendJson(response, 200, { users: getLinkedUsers() });
    return;
  }

  if (request.method !== 'POST' || routePath !== '/api/admin/linked-users') {
    sendJson(response, 404, { error: 'Not found.' });
    return;
  }
  if (!isSameOrigin(request)) {
    sendJson(response, 403, { error: 'Request origin was not accepted.' });
    return;
  }

  try {
    const input = await readJson(request);
    if (input.action === 'remove' || input.action === 'delete') {
      const discordId = String(input.discordId || '').trim();
      if (!/^\d{17,20}$/.test(discordId)) throw new Error('Enter a valid Discord user ID.');
      const removed = removeLinkedUsers([discordId]);
      sendJson(response, removed ? 200 : 404, { message: removed ? 'Linked account deleted.' : 'No linked account matched that Discord ID.' });
      return;
    }
    if (input.action === 'add') {
      const discordId = String(input.discordId || '').trim();
      const robloxId = String(input.robloxId || '').trim();
      const robloxUsername = String(input.robloxUsername || '').trim();
      if (!/^\d{17,20}$/.test(discordId)) throw new Error('Enter a valid Discord user ID.');
      if (!/^\d{1,20}$/.test(robloxId)) throw new Error('Enter a valid Roblox user ID.');
      if (!robloxUsername || robloxUsername.length > 64) throw new Error('Enter a Roblox username up to 64 characters.');
      const existingRobloxLink = getLinkedUsers().find((user) => user.robloxId === robloxId && user.discordId !== discordId);
      if (existingRobloxLink) throw new Error('That Roblox account is already linked to another Discord user.');
      saveLinkedUser({ discordId, robloxId, robloxUsername });
      sendJson(response, 200, { message: 'Linked account saved.' });
      return;
    }
    sendJson(response, 400, { error: 'Choose add or delete.' });
  } catch (error) {
    sendJson(response, 400, { error: error.message || 'The request could not be completed.' });
  }
}

async function handleWebInterface(request, response, client) {
  pruneExpiredState();
  const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (requestUrl.pathname !== PORTAL_PATH && !requestUrl.pathname.startsWith(`${PORTAL_PATH}/`)) return false;
  const pathname = requestUrl.pathname.slice(PORTAL_PATH.length) || '/';
  const rateLimitBucket = getRateLimitBucket(request, pathname);
  if (rateLimitBucket) {
    const { allowed, retryAfterSeconds } = consumeRateLimit(rateLimitBucket, request, RATE_LIMITS[rateLimitBucket]);
    if (!allowed) {
      sendJson(response, 429, { error: 'Too many requests. Try again shortly.' }, { 'Retry-After': String(retryAfterSeconds) });
      return true;
    }
  }

  if (request.method === 'GET' && (pathname === '/' || pathname === '/admin')) {
    const pagePath = path.join(WEB_ROOT, pathname === '/admin' ? 'admin.html' : 'member.html');
    const logo = fs.existsSync(MINISTRY_LOGO_PATH)
      ? '<img class="ministry-logo" src="/portal/assets/ministry-logo.png" alt="Ministry logo">'
      : '';
    const html = fs.readFileSync(pagePath, 'utf8').replace('<!-- MINISTRY_LOGO -->', logo);
    send(response, 200, 'text/html; charset=utf-8', html);
    return true;
  }

  const assets = {
    '/assets/portal.css': ['portal.css', 'text/css; charset=utf-8'],
    '/assets/portal.js': ['portal.js', 'text/javascript; charset=utf-8'],
    '/assets/ministry-logo.png': ['ministry-logo.png', 'image/png'],
  };
  if (request.method === 'GET' && assets[pathname]) {
    const [assetName, contentType] = assets[pathname];
    if (assetName === 'ministry-logo.png' && !fs.existsSync(MINISTRY_LOGO_PATH)) {
      send(response, 404, 'text/plain; charset=utf-8', 'Ministry logo is not installed.');
      return true;
    }
    const assetPath = assetName === 'ministry-logo.png' ? MINISTRY_LOGO_PATH : path.join(WEB_ROOT, assetName);
    send(response, 200, contentType, fs.readFileSync(assetPath));
    return true;
  }

  if (request.method === 'GET' && pathname === '/auth/discord') {
    await startDiscordLogin(request, response, requestUrl);
    return true;
  }

  if (request.method === 'GET' && pathname === '/auth/discord/callback') {
    await completeDiscordLogin(request, response, requestUrl, client);
    return true;
  }

  if (request.method === 'POST' && pathname === '/auth/logout') {
    const authenticated = getSession(request);
    if (authenticated) getDatabase().prepare('DELETE FROM portal_sessions WHERE session_id = ?').run(authenticated.sessionKey);
    sendJson(response, 200, { message: 'Signed out.' }, {
      'Set-Cookie': [
        `${SESSION_COOKIE}=; ${cookieOptions(request, 0)}`,
        `${SESSION_COOKIE}=; ${cookieOptions(request, 0, PORTAL_PATH)}`,
      ],
    });
    return true;
  }

  if (request.method === 'GET' && pathname === '/api/session') {
    const authenticated = getSession(request);
    if (!authenticated) {
      sendJson(response, 200, { authenticated: false, user: null, isAdmin: false, memberAccess: false });
      return true;
    }
    const userId = authenticated.session.user.id;
    const isAdmin = isPrivilegedUser(userId);
    const linkedUser = getLinkedUser(userId);
    let robloxGroupVerified = false;
    let robloxGroupVerificationAvailable = false;
    if (linkedUser) {
      try {
        robloxGroupVerified = await isRobloxGroupMember(linkedUser);
        robloxGroupVerificationAvailable = true;
      } catch (error) {
        console.warn('[portal] Roblox group membership check failed:', error.message || error);
      }
    }
    sendJson(response, 200, {
      authenticated: true,
      user: authenticated.session.user,
      isAdmin,
      robloxGroupVerified,
      robloxGroupVerificationAvailable,
      linkedAccountConfigured: Boolean(linkedUser),
      memberAccess: Boolean(robloxGroupVerified && linkedUser),
      linkedUser: robloxGroupVerified ? linkedUser : null,
    });
    return true;
  }

  if (request.method === 'GET' && pathname === '/api/member/dashboard') {
    const authenticated = requireSession(request, response);
    if (!authenticated) return true;
    const linkedUser = getLinkedUser(authenticated.session.user.id);
    if (!linkedUser) {
      sendJson(response, 403, { error: 'No linked Roblox account was found.' });
      return true;
    }
    let robloxGroupVerified;
    try {
      robloxGroupVerified = await isRobloxGroupMember(linkedUser);
    } catch (error) {
      console.warn('[portal] Roblox group membership check failed:', error.message || error);
      sendJson(response, 503, { error: 'Roblox group membership could not be verified. Try again shortly.' });
      return true;
    }
    if (!robloxGroupVerified) {
      sendJson(response, 403, { error: 'The linked Roblox account is not a member of the MoCS Roblox group.' });
      return true;
    }
    try {
      sendJson(response, 200, await getMemberDashboard(linkedUser, client));
    } catch (error) {
      console.error('[member-dashboard] Failed to load dashboard:', error);
      sendJson(response, 502, { error: 'Member data is temporarily unavailable.' });
    }
    return true;
  }

  if (pathname.startsWith('/api/admin/')) {
    const authenticated = requireSession(request, response);
    if (!authenticated) return true;
    await handleAdminApi(request, response, requestUrl, authenticated);
    return true;
  }

  return false;
}

module.exports = { handleWebInterface };