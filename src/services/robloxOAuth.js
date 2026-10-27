const crypto = require('crypto');

const AUTHORIZE_URL = 'https://apis.roblox.com/oauth/v1/authorize';
const TOKEN_URL = 'https://apis.roblox.com/oauth/v1/token';
const USERINFO_URL = 'https://apis.roblox.com/oauth/v1/userinfo';
const sessions = new Map();
const pendingConfirmations = new Map();
const SESSION_TTL_MS = 10 * 60 * 1000;
const CONFIRMATION_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_FLOWS = 1000;
const ROBLOX_OAUTH_TIMEOUT_MS = 10_000;

function base64Url(value) {
  return value.toString('base64url');
}

function pruneExpired(map, ttlMs) {
  const now = Date.now();
  for (const [key, value] of map) {
    if (now - value.createdAt > ttlMs) map.delete(key);
  }
}

function createAuthorizationUrl(discordId, guildId, flow = 'candidate') {
  pruneExpired(sessions, SESSION_TTL_MS);
  if (sessions.size >= MAX_PENDING_FLOWS) throw new Error('Too many Roblox verification requests are pending. Try again shortly.');
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  const state = base64Url(crypto.randomBytes(32));

  sessions.set(state, {
    discordId: String(discordId),
    guildId: guildId ? String(guildId) : null,
    flow: String(flow || 'candidate'),
    verifier,
    createdAt: Date.now(),
  });
  const params = new URLSearchParams({
    client_id: process.env.ROBLOX_OAUTH_CLIENT_ID || '',
    redirect_uri: process.env.ROBLOX_OAUTH_REDIRECT_URI || '',
    scope: 'openid profile',
    response_type: 'code',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `${AUTHORIZE_URL}?${params}`;
}

async function exchangeCode(code, session) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: process.env.ROBLOX_OAUTH_CLIENT_ID || '',
    code,
    code_verifier: session.verifier,
    redirect_uri: process.env.ROBLOX_OAUTH_REDIRECT_URI || '',
  });
  if (process.env.ROBLOX_OAUTH_CLIENT_SECRET) body.set('client_secret', process.env.ROBLOX_OAUTH_CLIENT_SECRET);

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(ROBLOX_OAUTH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Roblox OAuth token exchange failed: ${response.status}`);
  return response.json();
}

async function consumeCallback(url) {
  const params = new URL(url, process.env.ROBLOX_OAUTH_REDIRECT_URI).searchParams;
  const state = params.get('state');
  const session = state ? sessions.get(state) : null;
  if (!session || Date.now() - session.createdAt > SESSION_TTL_MS) {
    if (state) sessions.delete(state);
    throw new Error('The Roblox authorization session is missing or expired.');
  }
  sessions.delete(state);

  const error = params.get('error');
  if (error) throw new Error(params.get('error_description') || `Roblox authorization failed: ${error}`);

  const token = await exchangeCode(params.get('code'), session);
  const response = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${token.access_token}` },
    signal: AbortSignal.timeout(ROBLOX_OAUTH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Roblox user information lookup failed: ${response.status}`);
  const user = await response.json();

  return {
    discordId: session.discordId,
    guildId: session.guildId,
    flow: session.flow,
    robloxUser: {
      id: Number(user.sub),
      name: user.preferred_username || user.nickname || user.name,
      displayName: user.name || user.nickname || user.preferred_username,
    },
  };
}

function createAuthorizationConfirmation(callback) {
  pruneExpired(pendingConfirmations, CONFIRMATION_TTL_MS);
  if (pendingConfirmations.size >= MAX_PENDING_FLOWS) throw new Error('Too many Roblox confirmations are pending. Try again shortly.');

  const confirmationId = base64Url(crypto.randomBytes(18));
  pendingConfirmations.set(confirmationId, { ...callback, createdAt: Date.now() });
  return confirmationId;
}

function consumeAuthorizationConfirmation(confirmationId) {
  pruneExpired(pendingConfirmations, CONFIRMATION_TTL_MS);
  const key = String(confirmationId || '');
  const request = pendingConfirmations.get(key);
  if (!request) return null;
  pendingConfirmations.delete(key);
  return request;
}

module.exports = {
  createAuthorizationUrl,
  consumeCallback,
  createAuthorizationConfirmation,
  consumeAuthorizationConfirmation,
};