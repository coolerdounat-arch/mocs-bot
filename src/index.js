require('dotenv').config();
const http = require('http');
const { Client, GatewayIntentBits, Collection, MessageFlags, ActivityType } = require('discord.js');
const { consumeCallback, createAuthorizationConfirmation, consumeAuthorizationConfirmation } = require('./services/robloxOAuth');
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
const { checkCommandCooldown } = require('./services/commandCooldowns');
const { checkCommandAccess, leaveIfUnauthorizedGuild } = require('./services/commandAccess');
const { resolveLoadingEmoji } = require('./services/loadingScreen');
const { completeRestartNotice } = require('./services/restartNotice');
const { checkLinkedUsers } = require('./services/linkedUserChecker');
const { handleWebInterface } = require('./services/webInterface');

const LINKED_USERS_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const ROBLOX_CONFIRM_PATH = '/roblox/oauth/confirm';

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});
candidateCommand.setClient(client);

client.commands = new Collection();
for (const command of [
  greetCommand,
  profileCommand,
  checkCtCommand,
  checkJoinCommand,
  qpCommand,
  restartCommand,
  systemStatsCommand,
  candidateCommand,
  verifyCommand,
  logCtCommand,
  logPatrolCommand,
  logEventCommand,
  logOthersCommand,
  cacheCommand,
]) {
  client.commands.set(command.data.name, command);
}

function formatUptime(seconds) {
  const totalSeconds = Math.floor(seconds);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}

function updatePresence() {
  const uptime = `Uptime: ${formatUptime(process.uptime())}`;
  client.user.setPresence({
    activities: [{ name: 'Uptime', state: uptime, type: ActivityType.Custom }],
    status: 'online',
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function sendConfirmationPage(response, status, title, message, confirmationId = null) {
  const action = confirmationId
    ? `<form method="post" action="${ROBLOX_CONFIRM_PATH}"><input type="hidden" name="confirmation" value="${escapeHtml(confirmationId)}"><button name="decision" value="confirm" type="submit">Confirm account link</button> <button name="decision" value="cancel" type="submit">Cancel</button></form>`
    : '';
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  response.end(`<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${action}</main></html>`);
}

async function readForm(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 4096) throw new Error('Confirmation request is too large.');
  }
  return new URLSearchParams(body);
}

function isSameOrigin(request) {
  const origin = request.headers.origin;
  const host = String(request.headers['x-forwarded-host'] || request.headers.host || '').split(',')[0].trim();
  const forwardedProto = String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto === 'https' || request.socket.encrypted ? 'https' : 'http';
  return origin === `${protocol}://${host}`;
}

client.once('clientReady', () => {
  console.log(`Logged in as ${client.user.tag}.`);
  updatePresence();
  resolveLoadingEmoji(client);
  completeRestartNotice(client).catch((err) => console.warn('[restart] Could not update the restart message:', err.message || err));
  for (const guild of client.guilds.cache.values()) {
    leaveIfUnauthorizedGuild(guild).catch((err) => console.error(`[command-access] Could not leave guild ${guild.id}:`, err));
  }
  setInterval(updatePresence, 60_000);
  const runLinkedUsersCheck = () => {
    checkLinkedUsers().catch((err) => console.error('[linked-users] Daily check failed:', err));
  };
  runLinkedUsersCheck();
  setInterval(runLinkedUsersCheck, LINKED_USERS_CHECK_INTERVAL_MS);
});

const ROBLOX_CALLBACK_PATH = new URL(process.env.ROBLOX_OAUTH_REDIRECT_URI || 'http://localhost/').pathname;

const oauthServer = http.createServer(async (request, response) => {
  try {
    await handleOAuthRequest(request, response);
  } catch (error) {
    console.error('[http] Request failed:', error);
    if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Internal server error');
  }
});

async function handleOAuthRequest(request, response) {
  if (await handleWebInterface(request, response, client)) return;

  const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (request.method === 'POST' && requestUrl.pathname === ROBLOX_CONFIRM_PATH) {
    if (!isSameOrigin(request)) {
      sendConfirmationPage(response, 403, 'Confirmation rejected', 'This request did not come from this site.');
      return;
    }
    try {
      const form = await readForm(request);
      const callback = consumeAuthorizationConfirmation(form.get('confirmation'));
      if (!callback) {
        sendConfirmationPage(response, 400, 'Verification expired', 'Start the Roblox verification again from Discord.');
        return;
      }
      if (form.get('decision') !== 'confirm') {
        sendConfirmationPage(response, 200, 'Verification cancelled', 'No account was linked. You can close this page.');
        return;
      }

      const { flow, discordId, guildId, robloxUser } = callback;
      const result = flow === 'candidate'
        ? await candidateCommand.verifyCandidate(discordId, guildId, robloxUser, client)
        : await verifyCommand.verifyLinkedUser(discordId, guildId, robloxUser, client);
      sendConfirmationPage(response, 200, 'Roblox verification', result);
    } catch (error) {
      console.error('[roblox-oauth] Confirmation failed:', error);
      sendConfirmationPage(response, 500, 'Verification failed', 'Account verification could not be completed. Start again from Discord.');
    }
    return;
  }

  if (requestUrl.pathname !== ROBLOX_CALLBACK_PATH) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }

  try {
    const callback = await consumeCallback(requestUrl.toString());
    const confirmationId = createAuthorizationConfirmation(callback);
    let discordName = `Discord user ${callback.discordId}`;
    try {
      const discordUser = await client.users.fetch(callback.discordId);
      discordName = `${discordUser.globalName || discordUser.username} (${callback.discordId})`;
    } catch (error) {
      console.warn('[roblox-oauth] Could not resolve Discord confirmation name:', error.message || error);
    }
    sendConfirmationPage(
      response,
      200,
      'Confirm Roblox account link',
      `Roblox account ${callback.robloxUser.name} will be linked to ${discordName}. Confirm only if this is the Discord account you intended.`,
      confirmationId,
    );
  } catch (err) {
    console.error('Roblox OAuth callback failed:', err);
    response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<h1>Roblox verification failed</h1><p>Please return to Discord and try again.</p>');
  }
}

const oauthHost = process.env.ROBLOX_OAUTH_HOST || '127.0.0.1';
const oauthPort = Number(process.env.ROBLOX_OAUTH_PORT || 3000);
oauthServer.listen(oauthPort, oauthHost, () => {
  console.log(`Roblox OAuth callback listening on ${oauthHost}:${oauthPort}.`);
});

client.on('guildCreate', (guild) => {
  leaveIfUnauthorizedGuild(guild).catch((err) => console.error(`[command-access] Could not leave guild ${guild.id}:`, err));
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton()) {
    try {
      await candidateCommand.handleButton(interaction);
    } catch (err) {
      console.error('Error handling candidate button:', err);
    }
    return;
  }

  if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);
    if (!command?.autocomplete) return;
    try {
      await command.autocomplete(interaction);
    } catch (err) {
      console.error(`Error autocompleting /${interaction.commandName}:`, err);
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    const accessError = await checkCommandAccess(command, interaction);
    if (accessError) {
      await interaction.reply({ content: accessError, flags: MessageFlags.Ephemeral });
      return;
    }
    const cooldownEndsAt = checkCommandCooldown(command, interaction.user.id);
    if (cooldownEndsAt) {
      await interaction.reply({
        content: `Please wait before using /${interaction.commandName} again. You can retry <t:${Math.ceil(cooldownEndsAt / 1000)}:R>.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await command.execute(interaction);
  } catch (err) {
    if (err.code === 10062) {
      console.warn(`/${interaction.commandName} interaction expired or was already acknowledged.`);
      return;
    }
    console.error(`Error executing /${interaction.commandName}:`, err);
    const payload = { content: 'Something went wrong running that command.' };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload).catch(() => {});
    } else {
      await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
