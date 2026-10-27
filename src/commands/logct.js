const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { getUserGroupRoles } = require('../services/robloxGroups');
const { getBlacklistRows, normalizeMatch } = require('../services/googleSheets');
const { getRobloxUser, getRobloxUserById, getUsernameHistory } = require('../services/roblox');
const {
  getMocsGroupId,
  buildActivityRow,
  getLinkedMocsContext,
  appendAutoLogRows,
} = require('../services/activityLogger');
const { getLogTypeChoices } = require('../services/logTypes');
const { resolveProof } = require('../services/proofUploads');
const { getConfigValue, getNumericConfigValue } = require('../services/configuration');
const fs = require('fs');
const path = require('path');
const { showLoading } = require('../services/loadingScreen');

const data = new SlashCommandBuilder()
  .setName('log-ct')
  .setDescription('Log a Citizenship Test to the AutoLogs sheet.')
  .setIntegrationTypes(0)
  .setContexts(0)
  .addStringOption((option) => option
    .setName('log_type')
    .setDescription('Type of citizenship log')
    .addChoices(...getLogTypeChoices('log-ct'))
    .setRequired(true))
  .addStringOption((option) => option
    .setName('description')
    .setDescription('Description of the activity')
    .setRequired(true))
  .addStringOption((option) => option
    .setName('stayed_until_end')
    .setDescription('Did the testee stay until the end?')
    .addChoices(
      { name: 'Yes', value: 'Yes' },
      { name: 'No', value: 'No' },
    )
    .setRequired(true))
  .addStringOption((option) => option
    .setName('attendee')
    .setDescription('Username of the attendee')
    .setRequired(true))
  .addStringOption((option) => option
    .setName('passed')
    .setDescription('Did the testee pass?')
    .addChoices(
      { name: 'Yes', value: 'Yes' },
      { name: 'No', value: 'No' },
    )
    .setRequired(true))
  .addStringOption((option) => option
    .setName('mentorship')
    .setDescription('Was this a mentorship activity?')
    .addChoices(
      { name: 'Yes', value: 'Yes' },
      { name: 'No', value: 'No' },
    )
    .setRequired(true))
  .addStringOption((option) => option
    .setName('proof')
    .setDescription('Proof link')
    .setRequired(false))
  .addAttachmentOption((option) => option
    .setName('proof_file')
    .setDescription('Proof file upload')
    .setRequired(false));

function getGroupRole(groups = [], groupId) {
  return (groups || []).find((entry) => Number(entry?.group?.id) === groupId) || null;
}

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

async function runBackgroundCheck(attendeeUsername) {
  const irfGroupId = getNumericConfigValue('irf_group_id', 872876);
  const robloxUser = await getRobloxUser(attendeeUsername);
  if (!robloxUser) return { eligible: false, reasons: ['Roblox account was not found.'] };

  const [userInfo, nameHistory, groupRoles] = await Promise.all([
    getRobloxUserById(robloxUser.id),
    getUsernameHistory(robloxUser.id),
    getUserGroupRoles(robloxUser.id),
  ]);
  const reasons = [];
  const createdAt = userInfo?.created ? new Date(userInfo.created) : null;
  const accountAgeDays = createdAt && !Number.isNaN(createdAt.getTime())
    ? Math.floor((Date.now() - createdAt.getTime()) / (24 * 60 * 60 * 1000))
    : null;

  if (accountAgeDays === null || accountAgeDays < 60) {
    reasons.push('Roblox account is younger than 60 days.');
  }
  if (!getGroupRole(groupRoles, irfGroupId)) {
    reasons.push('User is not in the IRF main group.');
  }
  if (getGroupRole(groupRoles, getMocsGroupId())) {
    reasons.push('User is already in the Ministry of Civil Services.');
  }

  const enemyGroupIds = new Set(loadEnemyGroups().map((enemy) => enemy.groupId));
  const enemyGroup = groupRoles.find((entry) => enemyGroupIds.has(Number(entry?.group?.id)));
  if (enemyGroup) reasons.push(`User is in enemy group ${enemyGroup.group?.name || 'an enemy group'}.`);

  const blacklistMatch = await findBlacklistMatch(robloxUser);
  if (blacklistMatch) reasons.push(`User is blacklisted as ${blacklistMatch.username}.`);

  return {
    eligible: reasons.length === 0,
    reasons,
    robloxUser,
  };
}

async function notifyIneligibleCt(interaction, attendee, reasons) {
  const channelId = getConfigValue('ct_ineligible_notification_channel_id');
  const roleId = getConfigValue('ct_ineligible_notification_role_id');
  const channel = await interaction.client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased()) throw new Error('The ineligible CT notification channel is not a text channel.');

  await channel.send({
    content: `<@&${roleId}>`,
    embeds: [new EmbedBuilder()
      .setTitle('Ineligible Citizenship Test Notice')
      .setDescription('A Citizenship Test was submitted for a user who did not pass the background check.')
      .setColor(0xff0000)
      .addFields(
        { name: 'Attendee', value: attendee },
        { name: 'Submitted by', value: `<@${interaction.user.id}>` },
        { name: 'Reasons', value: reasons.join('\n') || 'Unknown' },
      )
      .setTimestamp()],
  });
}

async function findBlacklistMatch(robloxUser) {
  const names = [robloxUser.name, robloxUser.displayName];
  names.push(...await getUsernameHistory(robloxUser.id));

  const usernames = new Set(names.map(normalizeMatch).filter(Boolean));
  const blacklistRows = await getBlacklistRows();
  return blacklistRows.find((entry) => !entry.lifted && usernames.has(normalizeMatch(entry.username))) || null;
}

async function sendRankingRequest(interaction, attendeeUsername, proof, testerUsername, testerRank, stayedUntilEnd) {
  const irfGroupId = getNumericConfigValue('irf_group_id', 872876);
  const attendee = await getRobloxUser(attendeeUsername);
  if (!attendee) throw new Error(`Roblox user not found: ${attendeeUsername}`);

  const groupRoles = await getUserGroupRoles(attendee.id);
  const irfRole = getGroupRole(groupRoles, irfGroupId);
  const currentRankId = Number(irfRole?.role?.rank);
  const currentRank = irfRole?.role?.name || 'Not in group';
  const promotions = {
    10: 'Citizen',
    30: 'High Class Citizen',
  };
  const promotionRank = promotions[currentRankId] || 'Not eligible for a promotion.';
  const blacklistMatch = await findBlacklistMatch(attendee);

  const fields = [
    { name: "Tester's Username", value: testerUsername, inline: true },
    { name: "Tester's rank", value: testerRank, inline: true },
    { name: 'Did the testee stay until the end of the test?', value: stayedUntilEnd, inline: true },
    { name: 'Username of attendee', value: attendee.name, inline: true },
    { name: 'Current Rank', value: currentRank, inline: true },
    { name: 'Rank after Promotion', value: promotionRank, inline: true },
    { name: 'Proof', value: proof },
  ];
  if (blacklistMatch) {
    fields.push({
      name: 'Blacklist Warning',
      value: `Blacklisted username found: **${blacklistMatch.username}**.`,
    });
  }

  const channelId = getConfigValue('ct_ranking_channel_id');
  const roleId = getConfigValue('ct_ranking_role_id');
  const channel = await interaction.client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased()) {
    throw new Error(`Ranking channel ${channelId} is not a text channel.`);
  }

  await channel.send({
    content: `<@&${roleId}>`,
    embeds: [new EmbedBuilder()
      .setTitle('CT Ranking Request')
      .setDescription('The following user has passed a high class citizenship test and requires ranking:')
      .setColor(0x022953)
      .addFields(fields)
      .setTimestamp()],
  });
}

async function execute(interaction) {
  await showLoading(interaction, { ephemeral: true });

  let context;
  try {
    context = await getLinkedMocsContext(interaction.user.id);
  } catch (err) {
    console.error('[logct] Failed to fetch MoCS rank for linked Roblox user:', err);
    return interaction.editReply({
      content: 'I could not verify your MoCS rank right now. Please try again later.',
    });
  }
  if (context.error) return interaction.editReply({ content: context.error.replace('this command', '/log-ct') });

  const { robloxUsername, rank } = context;

  const getOption = (name) => interaction.options.getString(name) || '';
  const activity = getOption('log_type');
  const description = getOption('description');
  if (!description) return interaction.editReply({ content: 'Citizenship Test requires a description.' });

  const mentorship = getOption('mentorship');
  const attendee = getOption('attendee');
  const stayedUntilEnd = getOption('stayed_until_end');
  const passed = getOption('passed');
  if (!stayedUntilEnd || !attendee || !passed || !mentorship) {
    return interaction.editReply({ content: 'Citizenship Test requires stayed_until_end, attendee, passed, and mentorship.' });
  }

  let backgroundCheck;
  try {
    backgroundCheck = await runBackgroundCheck(attendee);
  } catch (err) {
    console.error('[logct] Background check failed:', err);
    return interaction.editReply({ content: 'User was not eligible.' });
  }

  if (!backgroundCheck.eligible) {
    try {
      await notifyIneligibleCt(interaction, attendee, backgroundCheck.reasons);
    } catch (err) {
      console.error('[logct] Failed to notify about ineligible CT:', err);
    }
    return interaction.editReply({ content: 'User was not eligible.' });
  }

  let proof;
  try {
    proof = await resolveProof({
      interaction,
      commandName: '/log-ct',
      details: {
        'Roblox user': robloxUsername,
        Rank: rank,
        'Log type': activity,
        Description: description,
        'Stayed until end': stayedUntilEnd,
        Attendee: attendee,
        Passed: passed,
        Mentorship: mentorship,
      },
    });
  } catch (err) {
    return interaction.editReply({ content: err.message });
  }

  const row = buildActivityRow({
    robloxUsername,
    rank,
    activity,
    description,
    stayedUntilEnd,
    attendee,
    passed,
    proof,
  });
  const rows = [row];

  if (mentorship === 'Yes') {
    rows.push([
      row[0],
      robloxUsername,
      rank,
      'Mentorship',
      description,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      attendee,
      proof,
      '',
    ]);
  }

  try {
    await appendAutoLogRows({ rows });
    let rankingNotice = '';
    if (passed === 'Yes') {
      try {
        await sendRankingRequest(
          interaction,
          attendee,
          proof,
          robloxUsername,
          rank,
          stayedUntilEnd,
        );
      } catch (err) {
        console.error('[logct] Failed to send CT ranking request:', err);
        rankingNotice = ' The ranking request could not be sent; check the bot logs.';
      }
    }

    return interaction.editReply({
      content: mentorship === 'Yes'
        ? `Logged a CT entry and a mentorship entry for ${robloxUsername} in the AutoLogs sheet.${rankingNotice}`
        : `Logged a CT entry for ${robloxUsername} in the AutoLogs sheet.${rankingNotice}`,
    });
  } catch (err) {
    console.error('[logct] Failed to append AutoLogs row:', err);
    return interaction.editReply({
      content: `The CT log could not be written. Please check the AutoLogs spreadsheet configuration: ${err.message}`,
    });
  }
}

module.exports = { data, execute, cooldownSeconds: 5 };
