const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { spawn } = require('child_process');
const { isPrivilegedDiscordUser } = require('../services/linkedUsers');
const { buildRestartingEmbed, saveRestartNotice } = require('../services/restartNotice');

const data = new SlashCommandBuilder()
  .setName('restart')
  .setDescription('Restart the bot and start a fresh process. Requires permission.')
  .setIntegrationTypes(0, 1)
  .setContexts(0, 1, 2);

async function execute(interaction) {
  if (!isPrivilegedDiscordUser(interaction.user.id)) {
    return interaction.reply({ content: 'You are not authorized to use this command.', flags: MessageFlags.Ephemeral });
  }

  const serviceRestartCommand = process.env.BOT_RESTART_COMMAND;
  try {
    await interaction.reply({
      embeds: [buildRestartingEmbed(interaction.client)],
      flags: MessageFlags.Ephemeral,
    });
    try {
      saveRestartNotice(interaction);
    } catch (err) {
      console.warn('Could not save the restart notice; the restart message will not be updated:', err.message || err);
    }
  } catch (err) {
    if (err.code !== 10062) throw err;
    console.warn('Restart interaction expired before it could be acknowledged. Continuing with restart.');
  }

  if (serviceRestartCommand) {
    const child = spawn('sh', ['-c', serviceRestartCommand], {
      cwd: process.cwd(),
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.unref();
    setTimeout(() => process.exit(0), 750);
    return;
  }

  const isWindows = process.platform === 'win32';
  if (!isWindows && process.env.STY) {
    const child = spawn('screen', [
      '-S', process.env.STY,
      '-X', 'screen',
      'bash', '-lc', 'npm install && npm start',
    ], {
      cwd: process.cwd(),
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.unref();
    setTimeout(() => process.exit(0), 750);
    return;
  }

  const child = spawn(
    isWindows ? 'cmd' : 'sh',
    isWindows
      ? ['/c', 'npm install && npm start']
      : ['-c', 'npm install && npm start'],
    {
      cwd: process.cwd(),
      detached: true,
      stdio: 'inherit',
      env: process.env,
    }
  );
  child.unref();

  setTimeout(() => process.exit(0), 750);
}

module.exports = { data, execute };
