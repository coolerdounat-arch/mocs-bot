const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const {
  getLinkedUser,
  getLinkedUsers,
  saveLinkedUser,
  assertRobloxLinkAvailable,
  isPrivilegedDiscordUser,
} = require('../services/linkedUsers');
const {
  getRobloxUserById,
  getUsernameHistory,
} = require('../services/roblox');
const { getUserGroupRoles } = require('../services/robloxGroups');
const { getMocsBlacklistRows, normalizeMatch } = require('../services/googleSheets');
const { createAuthorizationUrl, consumeCallback, createAuthorizationConfirmation } = require('../services/robloxOAuth');
const { getConfigValue } = require('../services/configuration');

const CANDIDATE_IMAGE_URL = process.env.CANDIDATE_IMAGE_URL || '';

const APPLY_BUTTON_ID = 'candidate:apply';
let discordClient = null;

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

const data = new SlashCommandBuilder()
  .setName('candidate')
  .setDescription('Post the Ministry of Civil Services candidacy application button.')
  .setIntegrationTypes(0)
  .setContexts(0);

function buildApplicationMessage() {
  const embed = new EmbedBuilder()
    .setColor(0x00b9ff)
    .setTitle('Ministry of Civil Service')
    .setDescription([
      '**Become a Candidate for MoCS today! - Click the button below.**',
      '',
      '**Requirements:**',
      'If you wish to join the MoCS, please make sure you meet all requirements and click the button below:',
      '',
      'Requirements to receive the Candidate role:',
      'In order to join the Ministry you need to meet these requirements:',
      '',
      '• Your account has to be created over 60 days ago.',
      '• You\'re not blacklisted from Candidacy.',
      '• You\'re not in any enemy groups.',
      '• You\'re a member of the Government group.',
    ].join('\n'))
    .setFooter({ text: 'Citizenship. Integration. Quality.' });

  if (CANDIDATE_IMAGE_URL) embed.setImage(CANDIDATE_IMAGE_URL);

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(APPLY_BUTTON_ID).setLabel('Apply for Candidacy').setStyle(ButtonStyle.Success),
    )],
  };
}

function buildWelcomeMessage(discordId) {
  const noviceProgramUrl = getConfigValue('candidate_novice_program_url');
  const databaseUrl = getConfigValue('candidate_database_url');
  return `<@${discordId}>\nWelcome to safe haven.\nRead:\n    \n<#1458229941362753596> <#840158939768946718> <#1458229993875312883> [NoviceProgram](${noviceProgramUrl})\nNote:\nYou have been assigned to the Federal Service Division. It is one of the three divisions within the Ministry of Civil Services.\nAs a Novice Serviceman, you will be required to complete a supervision replacement exam. You can request one in <#1458230086401658921>\n<@&1000696791488012300>\n\nYou will be inserted into the database soon. You can view your status in the FSD Novice Database sheet in the [[Civil Services] Activity Database](${databaseUrl}). You don\'t see yourself after 48 hours? Request to be inserted in <#1124006330852724736>!`;
}

async function logDeniedCandidate(client, discordId, robloxUser, reason) {
  const deniedLogChannelId = getConfigValue('candidate_denied_log_channel_id');
  if (!client?.channels?.fetch || !deniedLogChannelId) return;

  try {
    const channel = await client.channels.fetch(deniedLogChannelId);
    if (!channel?.isTextBased?.()) throw new Error('Candidate denial log channel is not a text channel.');

    await channel.send({
      embeds: [new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('Candidate application denied')
        .addFields(
          { name: 'Discord User', value: `<@${discordId}> (${discordId})`, inline: true },
          { name: 'Roblox User', value: `${robloxUser?.name || 'Unknown'} (${robloxUser?.id || 'Unknown'})`, inline: true },
          { name: 'Reason', value: reason },
        )],
    });
  } catch (err) {
    console.error('Candidate denial log failed:', err);
  }
}

async function denyCandidate(client, discordId, robloxUser, reason) {
  await logDeniedCandidate(client, discordId, robloxUser, reason);
  return reason;
}

async function execute(interaction) {
  if (!isPrivilegedDiscordUser(interaction.user.id)) {
    return interaction.reply({ content: 'You are not authorized to use this command.', flags: MessageFlags.Ephemeral });
  }

  return interaction.reply(buildApplicationMessage());
}

async function handleButton(interaction) {
  if (interaction.customId !== APPLY_BUTTON_ID) return false;

  console.log(`[candidate] Discord user ${interaction.user.id} opened the Roblox OAuth flow.`);
  if (!process.env.ROBLOX_OAUTH_CLIENT_ID || !process.env.ROBLOX_OAUTH_REDIRECT_URI) {
    await interaction.reply({ content: 'Roblox verification is not configured yet. Please contact an administrator.', flags: MessageFlags.Ephemeral });
    return true;
  }

  const oauthUrl = createAuthorizationUrl(interaction.user.id, interaction.guildId, 'candidate');
  await interaction.reply({
    content: 'Click below to authorize your Roblox account. You will be returned here after verification.',
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('Connect Roblox').setStyle(ButtonStyle.Link).setURL(oauthUrl),
    )],
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

async function handleOAuthCallback(requestUrl, client) {
  const callback = await consumeCallback(requestUrl);
  const confirmationId = createAuthorizationConfirmation(callback);
  return { discordId: callback.discordId, confirmationId, result: 'Awaiting browser confirmation.' };
}

async function verifyCandidate(discordId, guildId, robloxUser, client) {
  const ministryGroupId = getConfigValue('mocs_group_id');
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
    console.error('Roblox candidate eligibility lookup failed:', err);
    return denyCandidate(client, discordId, robloxUser, 'Something went wrong checking your eligibility.');
  }

  if (groupRoles.some((entry) => String(entry?.group?.id ?? '') === ministryGroupId)) {
    return denyCandidate(client, discordId, robloxUser, 'User is already in the Ministry of Civil Services.');
  }

  const createdAt = userInfo?.created ? new Date(userInfo.created) : null;
  const accountAgeDays = createdAt && !Number.isNaN(createdAt.getTime())
    ? Math.floor((Date.now() - createdAt.getTime()) / (24 * 60 * 60 * 1000))
    : null;
  if (accountAgeDays === null || accountAgeDays <= 60) {
    return denyCandidate(client, discordId, robloxUser, 'User does not meet the account age requirement.');
  }

  const userGroupIds = new Set(groupRoles.map((entry) => Number(entry?.group?.id)).filter(Number.isFinite));
  const enemyGroup = loadEnemyGroups().find((enemy) => userGroupIds.has(enemy.groupId));
  if (enemyGroup) {
    return denyCandidate(client, discordId, robloxUser, `User is in an enemy group: ${enemyGroup.groupName}.`);
  }

  let blacklistRows;
  try {
    blacklistRows = await getMocsBlacklistRows();
  } catch (err) {
    console.error('MoCS blacklist lookup failed:', err);
    return denyCandidate(client, discordId, robloxUser, 'Something went wrong checking your eligibility.');
  }
  if (findBlacklistEntry(blacklistRows, [robloxUser.name, robloxUser.displayName, ...nameHistory])) {
    return denyCandidate(client, discordId, robloxUser, 'User is blacklisted from candidacy.');
  }
  try {
    assertRobloxLinkAvailable(discordId, robloxUser.id, getLinkedUsers());
  } catch (error) {
    return denyCandidate(client, discordId, robloxUser, error.message || 'That Roblox account is already linked.');
  }

  if (!client?.guilds?.fetch || !client?.channels?.fetch) {
    throw new Error('Discord client is unavailable in the Roblox OAuth callback.');
  }

  const originatingGuildId = String(guildId || client.guilds.cache.first()?.id || '').trim();
  if (!originatingGuildId) throw new Error('The Roblox OAuth flow did not originate in a Discord server.');

  const guild = await client.guilds.fetch(originatingGuildId);
  if (!guild?.members?.fetch) throw new Error(`Discord guild ${originatingGuildId} does not expose a member manager.`);
  const member = await guild.members.fetch(discordId);
  try {
    saveLinkedUser({ discordId, robloxId: robloxUser.id, robloxUsername: robloxUser.name, linkStatus: 'candidate_pending' });
  } catch (error) {
    return denyCandidate(client, discordId, robloxUser, error.message || 'That Roblox account is already linked.');
  }
  await member.roles.add([
    getConfigValue('candidate_ministry_role_id'),
    getConfigValue('candidate_novice_role_id'),
  ]);

  const adminChannel = await client.channels.fetch(getConfigValue('candidate_admin_channel_id'));
  await adminChannel.send({
    content: `<@&${getConfigValue('candidate_notification_role_id')}>`,
    embeds: [new EmbedBuilder()
      .setColor(0x00b9ff)
      .setTitle('MoCS Bot')
      .setDescription(`**${robloxUser.name} has joined FSD!**\n\nPlease add the member above into the group and novice database!\n\nMinistry of Civil Services | Federal Service Division`)],
  });
  const welcomeChannel = await client.channels.fetch(getConfigValue('candidate_welcome_channel_id'));
  await welcomeChannel.send(buildWelcomeMessage(discordId));
  console.log(`[candidate] Linked Discord user ${discordId} to Roblox user ${robloxUser.id} (${robloxUser.name}).`);
  return 'Verification complete. You have been assigned the Ministry of Civil Services and Novice Serviceman roles.';
}

function setClient(client) {
  discordClient = client;
}

module.exports = {
  data,
  execute,
  cooldownSeconds: 30,
  handleButton,
  handleOAuthCallback,
  verifyCandidate,
  getLinkedUser,
  setClient,
};