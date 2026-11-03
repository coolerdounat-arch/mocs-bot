const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { completeRestartNotice, saveRestartNotice, takeRestartNotice } = require('../src/services/restartNotice');

const APPLICATION_ID = '123456789012345678';

function tempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'restart-notice-'));
}

test('restart notice is private, one-time, and expires with the interaction token', () => {
  const directory = tempDirectory();
  saveRestartNotice({ applicationId: APPLICATION_ID, token: 'interaction-token' }, { directory });
  const filePath = path.join(directory, `restart-notice-${APPLICATION_ID}.json`);
  assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
  assert.equal(takeRestartNotice(APPLICATION_ID, { directory }).token, 'interaction-token');
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(takeRestartNotice(APPLICATION_ID, { directory }), null);

  saveRestartNotice({ applicationId: APPLICATION_ID, token: 'old-token' }, { directory });
  assert.equal(takeRestartNotice(APPLICATION_ID, { directory, now: Date.now() + 15 * 60_000 }), null);
  assert.equal(fs.existsSync(filePath), false);
  assert.throws(() => saveRestartNotice({ applicationId: '../x', token: 't' }, { directory }), /Invalid application ID/);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('startup edits the original restart reply into a success embed', async () => {
  const directory = tempDirectory();
  saveRestartNotice({ applicationId: APPLICATION_ID, token: 'interaction-token' }, { directory });
  const patches = [];
  const client = {
    application: { id: APPLICATION_ID },
    user: { username: 'MoCS Test Bot', displayAvatarURL: () => 'https://cdn.discordapp.com/avatar.png' },
    rest: { patch: async (route, options) => { patches.push({ route, options }); } },
  };
  assert.equal(await completeRestartNotice(client, { directory }), true);
  assert.equal(patches[0].route, `/webhooks/${APPLICATION_ID}/interaction-token/messages/@original`);
  assert.equal(patches[0].options.auth, false);
  assert.match(patches[0].options.body.embeds[0].description, /^✅ Restart successful\. Back online after \d+\.\d seconds\.$/);
  assert.equal(await completeRestartNotice(client, { directory }), false);
  fs.rmSync(directory, { recursive: true, force: true });
});
