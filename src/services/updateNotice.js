const fs = require('fs');
const path = require('path');
const { EmbedBuilder, Routes } = require('discord.js');
const { getDatabasePath } = require('./linkedUsers');

const UPDATE_NOTICE_MAX_AGE_MS = 14 * 60_000;
const UPDATE_STATUS_FILE = '/var/lib/mocs-bot/update-status';
const UPDATE_NOTICE_POLL_INTERVAL_MS = 3_000;
const updatesInFlight = new Set();

function getUpdateNoticePath(applicationId, directory = path.dirname(getDatabasePath())) {
  if (!/^\d{17,20}$/.test(String(applicationId))) throw new Error('Invalid application ID for update notice.');
  return path.join(directory, `update-notice-${applicationId}.json`);
}

function saveUpdateNotice(interaction, previousUpdatedAt, { directory } = {}) {
  const filePath = getUpdateNoticePath(interaction.applicationId, directory);
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  const notice = {
    token: interaction.token,
    requestedAt: Date.now(),
    previousUpdatedAt: previousUpdatedAt || null,
  };
  fs.writeFileSync(temporaryPath, JSON.stringify(notice), { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporaryPath, filePath);
  fs.chmodSync(filePath, 0o600);
}

function readUpdateNotice(applicationId, { directory, now = Date.now() } = {}) {
  const filePath = getUpdateNoticePath(applicationId, directory);
  let notice;
  try {
    notice = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    fs.rmSync(filePath, { force: true });
    throw error;
  }
  if (typeof notice?.token !== 'string' || !Number.isFinite(notice.requestedAt)) {
    fs.rmSync(filePath, { force: true });
    return null;
  }
  if (now - notice.requestedAt > UPDATE_NOTICE_MAX_AGE_MS) {
    fs.rmSync(filePath, { force: true });
    return null;
  }
  return notice;
}

function removeUpdateNotice(applicationId, options = {}) {
  fs.rmSync(getUpdateNoticePath(applicationId, options.directory), { force: true });
}

function readUpdateStatus(statusFile = UPDATE_STATUS_FILE) {
  if (!fs.existsSync(statusFile)) return null;
  const values = {};
  for (const line of fs.readFileSync(statusFile, 'utf8').split(/\r?\n/)) {
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    values[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return values;
}

function buildUpdateCompletionEmbed(status) {
  const succeeded = status.state === 'succeeded';
  return new EmbedBuilder()
    .setColor(succeeded ? 0x2ecc71 : 0xff0000)
    .setTitle(succeeded ? 'Update Complete' : 'Update Failed')
    .setDescription(status.message || (succeeded ? 'The update completed.' : 'The update failed. Check the updater service journal.'))
    .addFields(
      { name: 'Progress', value: `**${Math.max(0, Math.min(100, Number(status.progress) || 0))}%**`, inline: true },
      { name: 'Phase', value: status.phase || '—', inline: true },
      { name: 'Updated', value: status.updatedAt || '—', inline: true },
    )
    .setTimestamp();
}

async function completeUpdateNotice(client, options = {}) {
  const filePath = getUpdateNoticePath(client.application.id, options.directory);
  if (updatesInFlight.has(filePath)) return false;
  updatesInFlight.add(filePath);
  try {
    const notice = readUpdateNotice(client.application.id, options);
    if (!notice) return false;
    const status = readUpdateStatus(options.statusFile);
    if (!status || !['succeeded', 'failed'].includes(status.state)
      || status.updatedAt === notice.previousUpdatedAt) return false;

    try {
      await client.rest.patch(Routes.webhookMessage(client.application.id, notice.token), {
        auth: false,
        body: { content: '', embeds: [buildUpdateCompletionEmbed(status).toJSON()] },
      });
    } catch (error) {
      if (error?.code !== 10062 && error?.code !== 10015 && error?.status !== 404) throw error;
      removeUpdateNotice(client.application.id, options);
      console.warn('[update] The interaction expired before the completion message could be updated.');
      return false;
    }
    removeUpdateNotice(client.application.id, options);
    return true;
  } finally {
    updatesInFlight.delete(filePath);
  }
}

function startUpdateNoticeWatcher(client, options = {}) {
  const checkNotice = () => {
    completeUpdateNotice(client, options)
      .catch((error) => console.warn('[update] Could not update the completion message:', error.message || error));
  };
  checkNotice();
  const timer = setInterval(checkNotice, UPDATE_NOTICE_POLL_INTERVAL_MS);
  timer.unref();
  return timer;
}

module.exports = {
  buildUpdateCompletionEmbed,
  completeUpdateNotice,
  getUpdateNoticePath,
  removeUpdateNotice,
  readUpdateNotice,
  saveUpdateNotice,
  startUpdateNoticeWatcher,
};
