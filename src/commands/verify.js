const { MessageFlags, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { getLinkedUser, saveLinkedUser, assertRobloxLinkAvailable } = require('../services/linkedUsers');
const { getRobloxUserById, getUsernameHistory } = require('../services/roblox');
const { getUserGroupRoles } = require('../services/robloxGroups');
const { getMocsBlacklistRows, normalizeMatch } = require('../services/googleSheets');
const { createAuthorizationUrl, consumeCallback, createAuthorizationConfirmation } = require('../services/robloxOAuth');

const data = new SlashCommandBuilder()
  .setName('verify')
  .setDescription('Verify your Roblox account and link it to your Discord profile.')
  .setIntegrationTypes(0)
  .setContexts(0);

function loadEnemyGroups() {
  const csvPath = path.join(__dirname, '../data/enemy-groups.csv');
  if (!fs.existsSync(csvPath)) return [];

  return fs.readFileSync(csvPath, 'utf8')
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const [rawGroupId, ...rest] = line.split(',');
      const groupId = Number(rawGroupId);
      const groupName = rest.join(',').trim();
      return Number.isFinite(groupId) && groupName ? { groupId, groupName } : null;
    })
    .filter(Boolean);
}

function findBlacklistEntry(rows, names) {
  const usernames = new Set(names.map(normalizeMatch).filter(Boolean));
  return rows.find((row) => !row.lifted && usernames.has(normalizeMatch(row.username))) || null;
}

async function execute(interaction) {
  if (!process.env.ROBLOX_OAUTH_CLIENT_ID || !process.env.ROBLOX_OAUTH_REDIRECT_URI) {
    return interaction.reply({
      content: 'Roblox verification is not configured yet. Please contact an administrator.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const linkedUser = getLinkedUser(interaction.user.id);
  if (linkedUser) {
    const oauthUrl = createAuthorizationUrl(interaction.user.id, interaction.guildId, 'verify');
    return interaction.reply({
      content: `Your Discord account is already linked to Roblox user ${linkedUser.robloxUsername}. Click below to reverify or link a different Roblox account.`,
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('Reverify Roblox').setStyle(ButtonStyle.Link).setURL(oauthUrl),
      )],
      flags: MessageFlags.Ephemeral,
    });
  }

  const oauthUrl = createAuthorizationUrl(interaction.user.id, interaction.guildId, 'verify');
  await interaction.reply({
    content: 'Click below to verify your Roblox account and link it to your Discord profile.',
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('Verify Roblox').setStyle(ButtonStyle.Link).setURL(oauthUrl),
    )],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleOAuthCallback(requestUrl, client) {
  const callback = await consumeCallback(requestUrl);
  const confirmationId = createAuthorizationConfirmation(callback);
  return { discordId: callback.discordId, guildId: callback.guildId, flow: callback.flow, confirmationId, result: 'Awaiting browser confirmation.' };
}

async function verifyLinkedUser(discordId, guildId, robloxUser, client) {
  let groupRoles;
  let userInfo;
  let nameHistory;
  try {
    [groupRoles, userInfo, nameHistory] = await Promise.all([
      getUserGroupRoles(robloxUser.id),
      getRobloxUserById(robloxUser.id),
      getUsernameHistory(robloxUser.id),
    ]);
  } catch (err) {
    console.error('Roblox verification lookup failed:', err);
    return 'Something went wrong checking your Roblox account. Please try again later.';
  }

  const createdAt = userInfo?.created ? new Date(userInfo.created) : null;
  const accountAgeDays = createdAt && !Number.isNaN(createdAt.getTime())
    ? Math.floor((Date.now() - createdAt.getTime()) / (24 * 60 * 60 * 1000))
    : null;
  if (accountAgeDays === null || accountAgeDays <= 60) return 'You do not meet the account age requirement.';

  const userGroupIds = new Set(groupRoles.map((entry) => Number(entry?.group?.id)).filter(Number.isFinite));
  if (loadEnemyGroups().some((enemy) => userGroupIds.has(enemy.groupId))) return 'You are currently ineligible to verify.';

  let blacklistRows;
  try {
    blacklistRows = await getMocsBlacklistRows();
  } catch (err) {
    console.error('MoCS blacklist lookup failed:', err);
    return 'Something went wrong checking your Roblox account. Please try again later.';
  }

  if (findBlacklistEntry(blacklistRows, [robloxUser.name, robloxUser.displayName, ...nameHistory])) {
    return 'You are currently ineligible to verify.';
  }

  try {
    assertRobloxLinkAvailable(discordId, robloxUser.id);
    saveLinkedUser({ discordId, robloxId: robloxUser.id, robloxUsername: robloxUser.name });
  } catch (error) {
    return error.message || 'That Roblox account could not be linked.';
  }
  console.log(`[verify] Linked Discord user ${discordId} to Roblox user ${robloxUser.id} (${robloxUser.name}).`);
  return 'Verification complete. Your Roblox account has been linked to your Discord profile.';
}

module.exports = { data, execute, cooldownSeconds: 30, handleOAuthCallback, verifyLinkedUser };
