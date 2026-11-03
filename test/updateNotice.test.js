const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
  completeUpdateNotice,
  getUpdateNoticePath,
  readUpdateNotice,
  saveUpdateNotice,
} = require('../src/services/updateNotice');

const APPLICATION_ID = '123456789012345678';

function tempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'update-notice-'));
}

function writeStatus(directory, values) {
  fs.writeFileSync(path.join(directory, 'status'), Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n'));
}

test('update notice is private, waits for a new terminal status, and is one-time', async () => {
  const directory = tempDirectory();
  const statusFile = path.join(directory, 'status');
  const interaction = {
    applicationId: APPLICATION_ID,
    token: 'interaction-token',
  };
  const client = {
    application: { id: APPLICATION_ID },
    rest: {
      patch: async (route, options) => {
        assert.equal(route, `/webhooks/${APPLICATION_ID}/interaction-token/messages/@original`);
        assert.equal(options.auth, false);
        assert.equal(options.body.embeds[0].title, 'Update Complete');
      },
    },
  };

  try {
    writeStatus(directory, {
      state: 'succeeded',
      updatedAt: '2026-11-03T20:00:00.000Z',
      phase: 'complete',
      message: 'Previous update finished.',
      progress: '100',
    });
    saveUpdateNotice(interaction, '2026-11-03T20:00:00.000Z', { directory });
    assert.equal(fs.statSync(getUpdateNoticePath(APPLICATION_ID, directory)).mode & 0o777, 0o600);
    assert.equal(await completeUpdateNotice(client, { directory, statusFile }), false);

    writeStatus(directory, {
      state: 'succeeded',
      updatedAt: '2026-11-03T20:01:00.000Z',
      phase: 'complete',
      message: 'Update finished.',
      progress: '100',
    });
    assert.equal(await completeUpdateNotice(client, { directory, statusFile }), true);
    assert.equal(readUpdateNotice(APPLICATION_ID, { directory }), null);
    assert.equal(await completeUpdateNotice(client, { directory, statusFile }), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('update notice expiry removes the interaction token file', () => {
  const directory = tempDirectory();
  try {
    saveUpdateNotice({ applicationId: APPLICATION_ID, token: 'expired-token' }, null, { directory });
    assert.equal(readUpdateNotice(APPLICATION_ID, {
      directory,
      now: Date.now() + 15 * 60_000,
    }), null);
    assert.equal(fs.existsSync(getUpdateNoticePath(APPLICATION_ID, directory)), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
