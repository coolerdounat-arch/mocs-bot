const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mocs-test-cache-'));
process.env.MOCS_SQLITE_FILE = path.join(testDirectory, 'users.sqlite3');
after(() => fs.rmSync(testDirectory, { recursive: true, force: true }));

const { createCache, getAllCacheStats, clearCaches } = require('../src/utils/cache');
const { checkCommandCooldown } = require('../src/services/commandCooldowns');
const { consumeRateLimit, getClientAddress } = require('../src/services/rateLimiter');
const { addPrivilegedUserId, closeLinkedUsersDatabase } = require('../src/services/linkedUsers');
after(() => closeLinkedUsersDatabase());

test('cache merges concurrent loads and serves hits until the TTL expires', async () => {
  const cache = createCache('test-ttl', { ttlMs: 40 });
  let loads = 0;
  const loader = async () => {
    loads += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { value: loads };
  };
  const [first, second] = await Promise.all([cache.wrap('key', loader), cache.wrap('key', loader)]);
  assert.deepEqual(first, { value: 1 });
  assert.deepEqual(second, { value: 1 });
  assert.deepEqual(await cache.wrap('key', loader), { value: 1 });
  assert.equal(loads, 1);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(await cache.wrap('key', loader), { value: 2 });
  assert.equal(cache.getStats().hits, 1);
  assert.equal(cache.getStats().loads, 2);
});

test('cache never stores failed or rejected loads', async () => {
  const cache = createCache('test-errors', { cacheIf: (value) => value !== null });
  await assert.rejects(cache.wrap('key', () => { throw new Error('sync failure'); }), /sync failure/);
  await assert.rejects(cache.wrap('key', async () => { throw new Error('async failure'); }), /async failure/);
  assert.equal(await cache.wrap('key', async () => null), null);
  assert.equal(cache.has('key'), false);
  assert.equal(await cache.wrap('key', async () => 'ok'), 'ok');
  assert.equal(cache.getStats().errors, 2);
});

test('cache returns isolated copies and evicts the least recently used entry', async () => {
  const cache = createCache('test-lru', { maxEntries: 2 });
  const value = await cache.wrap('a', async () => ({ list: [1] }));
  value.list.push(2);
  assert.deepEqual(cache.get('a'), { list: [1] });
  cache.set('b', 'b');
  cache.get('a');
  cache.set('c', 'c');
  assert.equal(cache.has('a'), true);
  assert.equal(cache.has('b'), false);
  assert.equal(cache.getStats().evictions, 1);
});

test('clearing a cache during a load discards the stale result', async () => {
  const cache = createCache('test-clear');
  let release;
  const pending = cache.wrap('key', () => new Promise((resolve) => { release = resolve; }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(clearCaches('test-clear')['test-clear'], 0);
  release('stale');
  assert.equal(await pending, 'stale');
  assert.equal(cache.has('key'), false);
  assert.ok(getAllCacheStats().some((stats) => stats.name === 'test-clear'));
  assert.throws(() => clearCaches('missing-cache'), /Unknown cache/);
});

test('command cooldowns apply per user and command, and privileged users bypass them', () => {
  const command = { data: { name: 'profile' }, cooldownSeconds: 10 };
  assert.equal(checkCommandCooldown(command, '111111111111111111'), null);
  assert.ok(checkCommandCooldown(command, '111111111111111111') > Date.now());
  assert.equal(checkCommandCooldown(command, '222222222222222222'), null);
  assert.equal(checkCommandCooldown({ data: { name: 'qp' }, cooldownSeconds: 10 }, '111111111111111111'), null);
  assert.equal(checkCommandCooldown({ data: { name: 'greet' } }, '111111111111111111'), null);
  addPrivilegedUserId('333333333333333333');
  assert.equal(checkCommandCooldown(command, '333333333333333333'), null);
  assert.equal(checkCommandCooldown(command, '333333333333333333'), null);
});

test('rate limits trust forwarded addresses only from the local proxy', () => {
  const proxied = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.9' } };
  const direct = { socket: { remoteAddress: '198.51.100.4' }, headers: { 'x-forwarded-for': '203.0.113.9' } };
  assert.equal(getClientAddress(proxied), '203.0.113.9');
  assert.equal(getClientAddress(direct), '198.51.100.4');
  assert.equal(consumeRateLimit('test', proxied, { limit: 2 }).allowed, true);
  assert.equal(consumeRateLimit('test', proxied, { limit: 2 }).allowed, true);
  const limited = consumeRateLimit('test', proxied, { limit: 2 });
  assert.equal(limited.allowed, false);
  assert.ok(limited.retryAfterSeconds >= 1);
  assert.equal(consumeRateLimit('test', direct, { limit: 2 }).allowed, true);
});
