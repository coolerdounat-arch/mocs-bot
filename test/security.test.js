const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { after, test } = require('node:test');

const configTestDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mocs-test-config-'));
process.env.MOCS_CONFIG_FILE = path.join(configTestDirectory, 'config.json');
process.env.MOCS_SQLITE_FILE = path.join(configTestDirectory, 'users.sqlite3');
fs.writeFileSync(process.env.MOCS_CONFIG_FILE, JSON.stringify({
  qp_sheet_id: 'test-qps',
  fsa_sheet_id: 'test-fsa',
  google_sheet_id: 'test-logs',
  google_sheet_tab: 'Quota Logs',
  google_sheet_start_row: '11',
  google_blacklist_sheet_id: 'test-blacklist',
  google_blacklist_sheet_tab: 'MoCS- CTs',
  google_blacklist_start_row: '11',
  google_groups_sheet_id: 'test-groups',
  google_groups_sheet_tab: 'Groups',
}), { mode: 0o600 });
after(() => fs.rmSync(configTestDirectory, { recursive: true, force: true }));

const { getUsernameHistory } = require('../src/services/roblox');
const { createAuthorizationConfirmation, consumeAuthorizationConfirmation } = require('../src/services/robloxOAuth');
const { buildAutoLogRow } = require('../src/services/autoLogs');
const {
  addPrivilegedUserId,
  assertRobloxLinkAvailable,
  closeLinkedUsersDatabase,
  getPrivilegedUserIds,
  isPrivilegedDiscordUser,
  removePrivilegedUserId,
  getDatabasePath,
  getLinkedUsers,
  getLinkedUserCount,
  importLinkedUsers,
  removeLinkedUsers,
  saveLinkedUser,
} = require('../src/services/linkedUsers');
const { handleWebInterface } = require('../src/services/webInterface');
const configuration = require('../src/services/configuration');

test('username history rejects incomplete provider pages', async () => {
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return calls === 1
      ? { ok: true, json: async () => ({ data: [{ name: 'Current' }], nextPageCursor: 'next' }) }
      : { ok: false, status: 429, statusText: 'Too Many Requests', headers: new Headers({ 'retry-after': '0.01' }) };
  };
  await assert.rejects(getUsernameHistory('1'), /429 Too Many Requests/);
  assert.equal(calls, 4);
});

test('username history retries a temporary Roblox rate limit', async () => {
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return calls === 1
      ? { ok: false, status: 429, statusText: 'Too Many Requests', headers: new Headers({ 'retry-after': '0.01' }) }
      : { ok: true, status: 200, headers: new Headers(), json: async () => ({ data: [{ name: 'OldName' }], nextPageCursor: null }) };
  };
  assert.deepEqual(await getUsernameHistory('2'), ['OldName']);
  assert.equal(calls, 2);
});

test('username history rejects results beyond its page limit', async () => {
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return { ok: true, json: async () => ({ data: [], nextPageCursor: 'next' }) };
  };
  await assert.rejects(getUsernameHistory('1'), /1,000-entry verification limit/);
  assert.equal(calls, 10);
});

test('OAuth account confirmation is one-time and names the intended identity', () => {
  const confirmationId = createAuthorizationConfirmation({
    discordId: '111111111111111111',
    guildId: '222222222222222222',
    flow: 'verify',
    robloxUser: { id: 123, name: 'RobloxUser', displayName: 'Roblox User' },
  });
  const callback = consumeAuthorizationConfirmation(confirmationId);
  assert.equal(callback.discordId, '111111111111111111');
  assert.equal(callback.robloxUser.name, 'RobloxUser');
  assert.equal(consumeAuthorizationConfirmation(confirmationId), null);
});

test('Discord OAuth callback requires the state cookie from its initiating browser', async () => {
  process.env.DISCORD_CLIENT_ID = 'test-client';
  process.env.DISCORD_OAUTH_CLIENT_SECRET = 'test-secret';
  global.fetch = async (url) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => String(url).includes('/oauth2/token')
      ? { access_token: 'access', token_type: 'Bearer' }
      : { id: '111111111111111111', username: 'ReviewAdmin' },
  });

  const server = http.createServer((request, response) => handleWebInterface(request, response, {}));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  process.env.DISCORD_OAUTH_REDIRECT_URI = `http://127.0.0.1:${port}/portal/auth/discord/callback`;
  const get = (pathname, headers = {}, targetPort = port) => new Promise((resolve, reject) => {
    const request = http.get({ hostname: '127.0.0.1', port: targetPort, path: pathname, headers }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        response.body = body;
        resolve(response);
      });
    });
    request.on('error', reject);
  });

  let secondServer;
  try {
    const login = await get('/portal/auth/discord');
    const state = new URL(login.headers.location).searchParams.get('state');
    const rejected = await get(`/portal/auth/discord/callback?state=${state}&code=untrusted`);
    assert.equal(rejected.statusCode, 302);
    assert.match(rejected.headers.location, /login=failed/);

    const nextLogin = await get('/portal/auth/discord');
    const nextState = new URL(nextLogin.headers.location).searchParams.get('state');
    const stateCookie = nextLogin.headers['set-cookie'][0].split(';')[0];
    const accepted = await get(`/portal/auth/discord/callback?state=${nextState}&code=valid`, { Cookie: stateCookie });
    assert.equal(accepted.statusCode, 302);
    assert.ok(accepted.headers['set-cookie'].some((value) => value.startsWith('discord_portal_session=')));

    const sessionCookie = accepted.headers['set-cookie']
      .find((value) => value.startsWith('discord_portal_session='))
      .split(';')[0];
    const rawSessionId = sessionCookie.slice('discord_portal_session='.length);
    const { getDatabase } = require('../src/services/linkedUsers');
    const storedSession = getDatabase().prepare('SELECT session_id FROM portal_sessions WHERE session_id IN (?, ?)')
      .all(rawSessionId, crypto.createHash('sha256').update(rawSessionId).digest('hex'));
    assert.deepEqual(storedSession.map((row) => row.session_id), [crypto.createHash('sha256').update(rawSessionId).digest('hex')]);
    const webInterfacePath = require.resolve('../src/services/webInterface');
    delete require.cache[webInterfacePath];
    const { handleWebInterface: independentHandler } = require('../src/services/webInterface');
    secondServer = http.createServer((request, response) => independentHandler(request, response, {}));
    await new Promise((resolve) => secondServer.listen(0, '127.0.0.1', resolve));
    const sessionResponse = await get('/portal/api/session', { Cookie: sessionCookie }, secondServer.address().port);
    assert.equal(sessionResponse.statusCode, 200);
    assert.equal(JSON.parse(sessionResponse.body).authenticated, true);

    const logout = await new Promise((resolve, reject) => {
      const request = http.request({
        hostname: '127.0.0.1',
        port: secondServer.address().port,
        path: '/portal/auth/logout',
        method: 'POST',
        headers: { Cookie: sessionCookie },
      }, (response) => {
        response.resume();
        response.on('end', () => resolve(response));
      });
      request.on('error', reject);
      request.end();
    });
    assert.equal(logout.statusCode, 200);
    const signedOut = await get('/portal/api/session', { Cookie: sessionCookie });
    assert.equal(JSON.parse(signedOut.body).authenticated, false);
  } finally {
    if (secondServer) await new Promise((resolve) => secondServer.close(resolve));
    await new Promise((resolve) => server.close(resolve));
    closeLinkedUsersDatabase();
  }
});

test('AutoLogs preserves generated timestamp and escapes formula-like text', () => {
  const row = buildAutoLogRow([
    '2026-09-28 12:30:00',
    '=IMPORTXML("https://example.invalid","//x")',
    '+SUM(1,1)',
    'ordinary text',
  ]);
  assert.equal(row[0], '2026-09-28 12:30:00');
  assert.ok(row[1].startsWith("'="));
  assert.ok(row[2].startsWith("'+"));
  assert.equal(row[3], 'ordinary text');
});

test('linked Roblox IDs cannot be assigned to a second Discord account', () => {
  const rows = [{ discordId: '111111111111111111', robloxId: '123', robloxUsername: 'RobloxUser' }];
  assert.throws(
    () => assertRobloxLinkAvailable('222222222222222222', '123', rows),
    /already linked/,
  );
  assert.doesNotThrow(() => assertRobloxLinkAvailable('111111111111111111', '123', rows));
});

test('linked account records are stored privately in SQLite and keep status', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mocs-links-test-'));
  const filePath = path.join(directory, 'users.sqlite3');
  const previousPath = process.env.MOCS_SQLITE_FILE;
  process.env.MOCS_SQLITE_FILE = filePath;
  try {
    assert.equal(getDatabasePath(), filePath);
    saveLinkedUser({ discordId: '111111111111111111', robloxId: '123', robloxUsername: 'RobloxUser', linkStatus: 'candidate_pending' });
    const [link] = getLinkedUsers();
    assert.equal(link.linkStatus, 'candidate_pending');
    assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
    assert.equal(removeLinkedUsers(['111111111111111111']), 1);
    assert.equal(getLinkedUserCount(), 0);
  } finally {
    closeLinkedUsersDatabase();
    if (previousPath === undefined) delete process.env.MOCS_SQLITE_FILE;
    else process.env.MOCS_SQLITE_FILE = previousPath;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('linked-user migration is transactional and rejects duplicates without partial import', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mocs-links-import-test-'));
  const previousPath = process.env.MOCS_SQLITE_FILE;
  process.env.MOCS_SQLITE_FILE = path.join(directory, 'users.sqlite3');
  const records = [
    { discordId: '111111111111111111', robloxId: '123', robloxUsername: 'First', linkStatus: 'active' },
    { discordId: '222222222222222222', robloxId: '123', robloxUsername: 'Duplicate', linkStatus: 'active' },
  ];
  try {
    assert.throws(() => importLinkedUsers(records), /UNIQUE constraint failed/);
    assert.equal(getLinkedUserCount(), 0);
    assert.equal(importLinkedUsers([records[0]]), 1);
  } finally {
    closeLinkedUsersDatabase();
    if (previousPath === undefined) delete process.env.MOCS_SQLITE_FILE;
    else process.env.MOCS_SQLITE_FILE = previousPath;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('privileged users live only in SQLite and the protected owner cannot be removed', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mocs-privileged-test-'));
  const previousPath = process.env.MOCS_SQLITE_FILE;
  process.env.MOCS_SQLITE_FILE = path.join(directory, 'users.sqlite3');
  try {
    const [protectedOwnerId] = getPrivilegedUserIds();
    assert.ok(protectedOwnerId);
    assert.equal(getPrivilegedUserIds().length, 1);
    assert.equal(addPrivilegedUserId('333333333333333333'), true);
    assert.equal(addPrivilegedUserId('333333333333333333'), false);
    assert.throws(() => addPrivilegedUserId('not-an-id'), /17-20 digits/);
    assert.equal(isPrivilegedDiscordUser('333333333333333333'), true);
    assert.equal(removePrivilegedUserId(protectedOwnerId), false);
    assert.equal(removePrivilegedUserId('333333333333333333'), true);
    assert.deepEqual(getPrivilegedUserIds(), [protectedOwnerId]);
    assert.deepEqual(fs.readdirSync(directory).filter((name) => !name.startsWith('users.sqlite3')), []);
  } finally {
    closeLinkedUsersDatabase();
    if (previousPath === undefined) delete process.env.MOCS_SQLITE_FILE;
    else process.env.MOCS_SQLITE_FILE = previousPath;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('private JSON configuration validates keys, writes atomically, and stays private', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mocs-config-test-'));
  const filePath = path.join(directory, 'config.json');
  const previousPath = process.env.MOCS_CONFIG_FILE;
  process.env.MOCS_CONFIG_FILE = filePath;
  try {
    configuration.writeConfiguration({ mocs_group_id: '10409578', google_sheet_tab: 'Quota Logs' });
    assert.equal(configuration.getConfigValue('google_sheet_tab'), 'Quota Logs');
    assert.equal(configuration.getNumericConfigValue('mocs_group_id', 1), 10409578);
    assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
    assert.throws(() => configuration.setConfigValue('unexpected_secret', 'value'), /Unsupported configuration key/);
    assert.throws(() => configuration.writeConfiguration({ mocs_group_id: 'bad\nvalue' }), /single-line string/);
  } finally {
    if (previousPath === undefined) delete process.env.MOCS_CONFIG_FILE;
    else process.env.MOCS_CONFIG_FILE = previousPath;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
