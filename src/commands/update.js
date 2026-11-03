const { spawn } = require('child_process');
const fs = require('fs');
const { EmbedBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { isPrivilegedDiscordUser } = require('../services/linkedUsers');
const { showLoading } = require('../services/loadingScreen');

const UPDATE_SERVICE = 'mocs-bot-update.service';
const UPDATE_HELPER = '/usr/local/sbin/mocs-bot-update';
const UPDATE_UNIT = `/etc/systemd/system/${UPDATE_SERVICE}`;
const UPDATE_STATUS_FILE = '/var/lib/mocs-bot/update-status';
const UPDATE_POLL_INTERVAL_MS = 3_000;
const UPDATE_START_TIMEOUT_MS = 30_000;
const PROGRESS_BAR_WIDTH = 20;

const data = new SlashCommandBuilder()
  .setName('update')
  .setDescription('Update the bot and Ubuntu server. Privileged users only.')
  .addBooleanOption((option) => option
    .setName('status')
    .setDescription('Show update progress instead of starting an update')
    .setRequired(false))
  .setIntegrationTypes(0)
  .setContexts(0);

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

function buildUpdateEmbed(status) {
  const active = status?.state === 'running';
  const progress = Math.max(0, Math.min(100, Number(status?.progress) || 0));
  const filled = Math.round(progress / 100 * PROGRESS_BAR_WIDTH);
  const progressBar = `${'█'.repeat(filled)}${'░'.repeat(PROGRESS_BAR_WIDTH - filled)}`;
  return new EmbedBuilder()
    .setColor(active ? 0x00b9ff : status?.state === 'failed' ? 0xff0000 : 0x00b050)
    .setTitle(active ? 'Update in Progress' : 'Last Update')
    .setDescription(status?.message || 'No update has been run yet.')
    .addFields(
      { name: 'Progress', value: `\`${progressBar}\` **${progress}%**`, inline: false },
      { name: 'State', value: status?.state || 'Not started', inline: true },
      { name: 'Phase', value: status?.phase || '—', inline: true },
      { name: 'Updated', value: status?.updatedAt || '—', inline: true },
    )
    .setTimestamp();
}

function statusChanged(status, previousStatus) {
  if (!status) return false;
  return ['state', 'phase', 'updatedAt', 'message', 'progress']
    .some((key) => status[key] !== previousStatus?.[key]);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isExpiredInteractionError(error) {
  return error?.code === 10062 || error?.code === 10015 || error?.status === 404;
}

function startUpdateJob() {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/sudo', [
      '-n',
      '/usr/bin/systemctl',
      'start',
      '--no-block',
      UPDATE_SERVICE,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let output = '';
    const appendOutput = (chunk) => {
      output = `${output}${chunk}`.slice(-4096);
    };
    child.stdout.on('data', appendOutput);
    child.stderr.on('data', appendOutput);
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(output.trim() || `Updater service could not be started (exit code ${code}).`));
    });
  });
}

async function execute(interaction) {
  if (!isPrivilegedDiscordUser(interaction.user.id)) {
    return interaction.reply({
      content: 'You are not authorized to use this command.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (interaction.options.getBoolean('status')) {
    return interaction.reply({
      embeds: [buildUpdateEmbed(readUpdateStatus())],
      flags: MessageFlags.Ephemeral,
    });
  }

  const status = readUpdateStatus();
  if (status?.state === 'running') {
    return interaction.reply({
      embeds: [buildUpdateEmbed(status)],
      flags: MessageFlags.Ephemeral,
    });
  }

  await showLoading(interaction, { ephemeral: true, message: 'Preparing the updater...' });

  if (!fs.existsSync(UPDATE_HELPER) || !fs.existsSync(UPDATE_UNIT)) {
    return interaction.editReply('The server updater is not installed. An administrator must follow the `/update` setup instructions in the README first.');
  }

  try {
    await interaction.setLoadingMessage('Starting the updater service...');
    await startUpdateJob();
  } catch (err) {
    console.error('[update] Could not start updater service:', err);
    return interaction.editReply({
      content: 'The update job could not be started. Check the bot service journal and updater permissions.',
    });
  }

  const startTime = Date.now();
  let canEditReply = true;
  let previousStatus = status;
  while (true) {
    const currentStatus = readUpdateStatus();
    if (statusChanged(currentStatus, previousStatus)) {
      previousStatus = currentStatus;
      if (currentStatus.state !== 'running') {
        if (canEditReply) return interaction.editReply({ embeds: [buildUpdateEmbed(currentStatus)] });
        return;
      }
      if (canEditReply) {
        try {
          await interaction.editReply({ embeds: [buildUpdateEmbed(currentStatus)] });
        } catch (err) {
          if (!isExpiredInteractionError(err)) throw err;
          console.warn('[update] Interaction expired while reporting progress; updater continues in the background.');
          canEditReply = false;
        }
      }
    } else if (Date.now() - startTime >= UPDATE_START_TIMEOUT_MS) {
      if (canEditReply) {
        return interaction.editReply({
          content: 'The updater did not report progress in time. Check `/update status:true` or the updater service journal.',
        });
      }
      return;
    } else if (canEditReply) {
      await interaction.setLoadingMessage('Waiting for the updater to report its first progress...');
    }

    await sleep(UPDATE_POLL_INTERVAL_MS);
  }
}

module.exports = {
  data,
  execute,
  readUpdateStatus,
  buildUpdateEmbed,
  startUpdateJob,
  statusChanged,
};
