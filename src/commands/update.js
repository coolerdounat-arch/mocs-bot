const { spawn } = require('child_process');
const fs = require('fs');
const { EmbedBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { isPrivilegedDiscordUser } = require('../services/linkedUsers');

const UPDATE_SERVICE = 'mocs-bot-update.service';
const UPDATE_HELPER = '/usr/local/sbin/mocs-bot-update';
const UPDATE_UNIT = `/etc/systemd/system/${UPDATE_SERVICE}`;
const UPDATE_STATUS_FILE = '/var/lib/mocs-bot/update-status';

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
  return new EmbedBuilder()
    .setColor(active ? 0x00b9ff : status?.state === 'failed' ? 0xff0000 : 0x00b050)
    .setTitle(active ? 'Update in Progress' : 'Last Update')
    .setDescription(status?.message || 'No update has been run yet.')
    .addFields(
      { name: 'State', value: status?.state || 'Not started', inline: true },
      { name: 'Phase', value: status?.phase || '—', inline: true },
      { name: 'Updated', value: status?.updatedAt || '—', inline: true },
    )
    .setTimestamp();
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

  if (!fs.existsSync(UPDATE_HELPER) || !fs.existsSync(UPDATE_UNIT)) {
    return interaction.reply({
      content: 'The server updater is not installed. An administrator must follow the `/update` setup instructions in the README first.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await startUpdateJob();
    const status = readUpdateStatus();
    return interaction.editReply({
      embeds: [buildUpdateEmbed(status?.state === 'running' ? status : {
        state: 'running',
        phase: 'queued',
        message: 'The update job is queued. Use `/update status:true` to check its progress.',
      })],
    });
  } catch (err) {
    console.error('[update] Could not start updater service:', err);
    return interaction.editReply({
      content: 'The update job could not be started. Check the bot service journal and updater permissions.',
    });
  }
}

module.exports = {
  data,
  execute,
  readUpdateStatus,
  buildUpdateEmbed,
  startUpdateJob,
};
