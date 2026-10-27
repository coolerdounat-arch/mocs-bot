const { ALLOWED_GUILD_IDS } = require('../data/allowed-guild-ids');
const { isPrivilegedDiscordUser } = require('./linkedUsers');
const { getLinkedMocsContext } = require('./activityLogger');

const MEMBER_MINIMUM_RANK = 1;
const MEMBER_CHECK_TIMEOUT_MS = 2_000;
const GUILD_DENIED_MESSAGE = 'This bot can only be used in the official MoCS servers.';
const PRIVILEGED_DENIED_MESSAGE = 'You are not authorized to use this command.';
const MEMBER_CHECK_FAILED_MESSAGE = 'I could not verify your MoCS membership right now. Please try again in a moment.';

function getAllowedGuildIds() {
  const configured = String(process.env.ALLOWED_GUILD_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => /^\d{17,20}$/.test(id));
  return new Set(configured.length ? configured : ALLOWED_GUILD_IDS);
}

function isAllowedGuild(guildId) {
  return !guildId || getAllowedGuildIds().has(String(guildId));
}

function withTimeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Membership check timed out.')), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function checkCommandAccess(command, interaction, {
  isPrivileged = isPrivilegedDiscordUser,
  getMemberContext = getLinkedMocsContext,
  timeoutMs = MEMBER_CHECK_TIMEOUT_MS,
} = {}) {
  const userId = interaction.user.id;
  if (isPrivileged(userId)) return null;
  if (!isAllowedGuild(interaction.guildId)) return GUILD_DENIED_MESSAGE;
  if (command.access === 'privileged') return PRIVILEGED_DENIED_MESSAGE;
  if (command.access !== 'member') return null;

  try {
    const context = await withTimeout(getMemberContext(userId, command.minimumRank ?? MEMBER_MINIMUM_RANK), timeoutMs);
    return context.error || null;
  } catch (error) {
    console.warn(`[command-access] Membership check for /${command.data?.name} failed:`, error.message || error);
    return MEMBER_CHECK_FAILED_MESSAGE;
  }
}

async function leaveIfUnauthorizedGuild(guild) {
  if (!getAllowedGuildIds().size || isAllowedGuild(guild.id)) return false;
  console.warn(`[command-access] Leaving unauthorized guild ${guild.name} (${guild.id}).`);
  await guild.leave();
  return true;
}

module.exports = {
  MEMBER_MINIMUM_RANK,
  checkCommandAccess,
  getAllowedGuildIds,
  isAllowedGuild,
  leaveIfUnauthorizedGuild,
};
