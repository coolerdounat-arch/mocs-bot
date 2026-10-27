const fs = require('fs');
const path = require('path');
const { EmbedBuilder, Routes } = require('discord.js');
const { getDatabasePath } = require('./linkedUsers');
const { buildLoadingEmbed } = require('./loadingScreen');

const RESTART_NOTICE_MAX_AGE_MS = 14 * 60_000;
const SUCCESS_COLOR = 0x2ecc71;

function getNoticePath(applicationId, directory = path.dirname(getDatabasePath())) {
  if (!/^\d{17,20}$/.test(String(applicationId))) throw new Error('Invalid application ID for restart notice.');
  return path.join(directory, `restart-notice-${applicationId}.json`);
}

function buildRestartingEmbed(client) {
  return buildLoadingEmbed(client, 'Restarting the bot. This may take a moment...');
}

function buildRestartedEmbed(client, downtimeMs) {
  return new EmbedBuilder()
    .setColor(SUCCESS_COLOR)
    .setDescription(`✅ Restart successful. Back online after ${(downtimeMs / 1000).toFixed(1)} seconds.`)
    .setFooter({ text: client.user.username, iconURL: client.user.displayAvatarURL() })
    .setTimestamp();
}

function saveRestartNotice(interaction, { directory } = {}) {
  const filePath = getNoticePath(interaction.applicationId, directory);
  const notice = { token: interaction.token, requestedAt: Date.now() };
  fs.writeFileSync(filePath, JSON.stringify(notice), { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

function takeRestartNotice(applicationId, { directory, now = Date.now() } = {}) {
  const filePath = getNoticePath(applicationId, directory);
  let notice;
  try {
    notice = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    fs.rmSync(filePath, { force: true });
    throw error;
  }
  fs.rmSync(filePath, { force: true });
  if (typeof notice?.token !== 'string' || !Number.isFinite(notice.requestedAt)) return null;
  if (now - notice.requestedAt > RESTART_NOTICE_MAX_AGE_MS) return null;
  return notice;
}

async function completeRestartNotice(client, options = {}) {
  const notice = takeRestartNotice(client.application.id, options);
  if (!notice) return false;
  await client.rest.patch(Routes.webhookMessage(client.application.id, notice.token), {
    auth: false,
    body: { content: '', embeds: [buildRestartedEmbed(client, Date.now() - notice.requestedAt).toJSON()] },
  });
  return true;
}

module.exports = {
  buildRestartingEmbed,
  buildRestartedEmbed,
  completeRestartNotice,
  saveRestartNotice,
  takeRestartNotice,
};
