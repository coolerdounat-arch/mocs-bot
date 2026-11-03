const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
  data,
  buildUpdateEmbed,
  readUpdateStatus,
  statusChanged,
} = require('../src/commands/update');
const { getLoadingEmoji } = require('../src/services/loadingScreen');

test('update is registered with a status option', () => {
  const command = data.toJSON();
  assert.equal(command.name, 'update');
  assert.equal(command.options[0].name, 'status');
});

test('update status reads phase details and presents an update embed', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mocs-update-test-'));
  const statusPath = path.join(directory, 'status');
  try {
    fs.writeFileSync(statusPath, [
      'state=running',
      'phase=ubuntu-upgrade',
      'updatedAt=2026-11-03T19:00:00Z',
      'message=Updating Ubuntu packages.',
      'progress=60',
      '',
    ].join('\n'));

    const status = readUpdateStatus(statusPath);
    const embed = buildUpdateEmbed(status).toJSON();
    assert.equal(status.phase, 'ubuntu-upgrade');
    assert.equal(embed.title, 'Update in Progress');
    assert.equal(embed.description, 'Updating Ubuntu packages.');
    assert.equal(embed.fields[2].value, 'ubuntu-upgrade');
    assert.ok(embed.fields[0].value.endsWith(`${getLoadingEmoji()} **60%**`));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('update status without a status file is empty', () => {
  assert.equal(readUpdateStatus('/nonexistent/mocs-update-status-test'), null);
});

test('update progress detects a new phase and progress value', () => {
  const previous = { state: 'running', phase: 'prepare', progress: '5' };
  assert.equal(statusChanged({ ...previous }, previous), false);
  assert.equal(statusChanged({ ...previous, phase: 'health-check' }, previous), true);
  assert.equal(statusChanged({ ...previous, progress: '45' }, previous), true);
});
