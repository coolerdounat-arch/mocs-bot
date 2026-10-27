require('dotenv').config();
const { REST, Routes } = require('discord.js');
const greetCommand = require('./commands/greet');
const profileCommand = require('./commands/profile');
const checkCtCommand = require('./commands/check-ct');
const checkJoinCommand = require('./commands/check-join');
const qpCommand = require('./commands/qp');
const restartCommand = require('./commands/restart');
const systemStatsCommand = require('./commands/system-stats');
const candidateCommand = require('./commands/candidate');
const verifyCommand = require('./commands/verify');
const logCtCommand = require('./commands/logct');
const logPatrolCommand = require('./commands/logpatrol');
const logEventCommand = require('./commands/log-event');
const logOthersCommand = require('./commands/log-others');
const cacheCommand = require('./commands/cache');

const commands = [
  greetCommand.data.toJSON(),
  profileCommand.data.toJSON(),
  checkCtCommand.data.toJSON(),
  checkJoinCommand.data.toJSON(),
  qpCommand.data.toJSON(),
  restartCommand.data.toJSON(),
  systemStatsCommand.data.toJSON(),
  candidateCommand.data.toJSON(),
  verifyCommand.data.toJSON(),
  logCtCommand.data.toJSON(),
  logPatrolCommand.data.toJSON(),
  logEventCommand.data.toJSON(),
  logOthersCommand.data.toJSON(),
  cacheCommand.data.toJSON(),
];

const rest = new REST({ timeout: 15_000 }).setToken(process.env.DISCORD_TOKEN);

function normalizeCommandName(command) {
  return String(command.name || '').trim().toLowerCase();
}

function diffCommands(existingCommands, newCommands) {
  const existingByName = new Map(existingCommands.map((command) => [normalizeCommandName(command), command]));
  return newCommands.filter((command) => !existingByName.has(normalizeCommandName(command)));
}

function getStaleCommands(existingCommands, newCommands) {
  const wantedByName = new Set(newCommands.map((command) => normalizeCommandName(command)));
  return existingCommands.filter((command) => !wantedByName.has(normalizeCommandName(command)));
}

function normalizeCommandDefinition(command) {
  const { id, application_id, version, ...definition } = command;
  return JSON.stringify(definition);
}

function getChangedCommands(existingCommands, newCommands) {
  const existingByName = new Map(existingCommands.map((command) => [normalizeCommandName(command), command]));
  return newCommands.filter((command) => {
    const existing = existingByName.get(normalizeCommandName(command));
    return existing && normalizeCommandDefinition(existing) !== normalizeCommandDefinition(command);
  });
}

async function deployGuildCommands(targetGuildId) {
  const route = Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, targetGuildId);
  const existing = await rest.get(route);
  const missing = diffCommands(existing, commands);
  const stale = getStaleCommands(existing, commands);
  const changed = getChangedCommands(existing, commands);

  if (!missing.length && !stale.length && !changed.length) {
    console.log(`No new, changed, or stale commands to deploy for guild ${targetGuildId}.`);
    return;
  }

  const definitionsByName = new Map([...missing, ...changed].map((command) => [normalizeCommandName(command), command]));
  const updated = [
    ...existing
      .filter((command) => !stale.some((staleCommand) => normalizeCommandName(staleCommand) === normalizeCommandName(command)))
      .map((command) => definitionsByName.get(normalizeCommandName(command)) || command),
    ...missing.filter((command) => !changed.some((changedCommand) => normalizeCommandName(changedCommand) === normalizeCommandName(command))),
  ];

  await rest.put(route, { body: updated });
  console.log(`Synced ${missing.length} new, ${changed.length} changed command(s), and removed ${stale.length} stale command(s) for guild ${targetGuildId}.`);
}

async function deployGlobalCommands() {
  const route = Routes.applicationCommands(process.env.DISCORD_CLIENT_ID);
  const existing = await rest.get(route);
  const missing = diffCommands(existing, commands);
  const stale = getStaleCommands(existing, commands);
  const changed = getChangedCommands(existing, commands);

  if (!missing.length && !stale.length && !changed.length) {
    console.log('No new, changed, or stale global commands to deploy.');
    return;
  }

  const definitionsByName = new Map([...missing, ...changed].map((command) => [normalizeCommandName(command), command]));
  const updated = [
    ...existing
      .filter((command) => !stale.some((staleCommand) => normalizeCommandName(staleCommand) === normalizeCommandName(command)))
      .map((command) => definitionsByName.get(normalizeCommandName(command)) || command),
    ...missing.filter((command) => !changed.some((changedCommand) => normalizeCommandName(changedCommand) === normalizeCommandName(command))),
  ];

  await rest.put(route, { body: updated });
  console.log(`Synced ${missing.length} new, ${changed.length} changed command(s), and removed ${stale.length} stale command(s).`);
}

(async () => {
  try {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const guildId = process.env.DISCORD_GUILD_ID;
    const guildIds = new Set([guildId, ...(process.env.DISCORD_COMMAND_GUILD_IDS || '').split(',')]
      .map((id) => String(id || '').trim())
      .filter(Boolean));

    if (guildId) {
      await deployGuildCommands(guildId);
      for (const id of guildIds) {
        if (id === guildId) continue;
        await deployGuildCommands(id);
      }
      console.log(`Finished guild deploy for ${guildId}.`);
    } else {
      await deployGlobalCommands();
      console.log('Finished global deploy.');
    }
  } catch (err) {
    console.error('Failed to register commands:', err);
    process.exit(1);
  }
})();
