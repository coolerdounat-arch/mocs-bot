const assert = require('node:assert/strict');
const { test } = require('node:test');
const { checkCommandAccess, isAllowedGuild, leaveIfUnauthorizedGuild } = require('../src/services/commandAccess');
const { ALLOWED_GUILD_IDS } = require('../src/data/allowed-guild-ids');

const [OFFICIAL_GUILD] = ALLOWED_GUILD_IDS;
const FOREIGN_GUILD = '123456789012345678';
const member = { data: { name: 'profile' }, access: 'member' };
const privileged = { data: { name: 'system-stats' }, access: 'privileged' };
const open = { data: { name: 'greet' } };

function interaction(guildId, userId = '111111111111111111') {
  return { guildId, user: { id: userId } };
}

const notPrivileged = { isPrivileged: () => false };

test('commands are refused outside the official servers but allowed in DMs', async () => {
  assert.equal(isAllowedGuild(OFFICIAL_GUILD), true);
  assert.equal(isAllowedGuild(null), true);
  assert.equal(isAllowedGuild(FOREIGN_GUILD), false);
  assert.match(await checkCommandAccess(open, interaction(FOREIGN_GUILD), notPrivileged), /official MoCS servers/);
  assert.equal(await checkCommandAccess(open, interaction(OFFICIAL_GUILD), notPrivileged), null);
});

test('member commands require a linked MoCS member and fail closed', async () => {
  const calls = [];
  const ok = { ...notPrivileged, getMemberContext: async (id, rank) => { calls.push([id, rank]); return { rank: 'Member' }; } };
  assert.equal(await checkCommandAccess(member, interaction(null), ok), null);
  assert.deepEqual(calls, [['111111111111111111', 1]]);

  const denied = { ...notPrivileged, getMemberContext: async () => ({ error: 'Please use /verify first.' }) };
  assert.equal(await checkCommandAccess(member, interaction(OFFICIAL_GUILD), denied), 'Please use /verify first.');

  const slow = { ...notPrivileged, timeoutMs: 10, getMemberContext: () => new Promise(() => {}) };
  assert.match(await checkCommandAccess(member, interaction(OFFICIAL_GUILD), slow), /could not verify/);
});

test('privileged users bypass every gate and others cannot run privileged commands', async () => {
  const admin = { isPrivileged: () => true, getMemberContext: async () => { throw new Error('not called'); } };
  assert.equal(await checkCommandAccess(privileged, interaction(FOREIGN_GUILD), admin), null);
  assert.equal(await checkCommandAccess(member, interaction(OFFICIAL_GUILD), admin), null);
  assert.match(await checkCommandAccess(privileged, interaction(OFFICIAL_GUILD), notPrivileged), /not authorized/);
});

test('the bot leaves servers that are not on the allowlist', async () => {
  let left = 0;
  const guild = (id) => ({ id, name: 'Test', leave: async () => { left += 1; } });
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await leaveIfUnauthorizedGuild(guild(OFFICIAL_GUILD)), false);
    assert.equal(await leaveIfUnauthorizedGuild(guild(FOREIGN_GUILD)), true);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(left, 1);
});
