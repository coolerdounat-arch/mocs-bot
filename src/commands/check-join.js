const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const {
  getRobloxUser,
  getRobloxUserById,
  getUsernameHistory,
  getAvatarHeadshotUrl,
} = require('../services/roblox');
const { getUserGroupRoles } = require('../services/robloxGroups');
const { getMocsBlacklistRows, normalizeMatch } = require('../services/googleSheets');
const { serialToDate } = require('../utils/format');
const { getNumericConfigValue } = require('../services/configuration');
const { showLoading } = require('../services/loadingScreen');

const COLOR_ALLOWED = 0x00ff00;
const COLOR_DENIED = 0xff0000;

const data = new SlashCommandBuilder()
  .setName('check-join')
  .setDescription('Check eligibility for Ministry of Civil Services candidacy')
  .addStringOption((opt) => opt
    .setName('username')
    .setDescription('Roblox username to check (required)')
    .setRequired(true))
  .setIntegrationTypes(0, 1)
  .setContexts(0, 1, 2);

function daysSince(date) {
  return Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
}

function findGroupRole(groupRoles, groupId) {
  return (groupRoles || []).find((entry) => String(entry?.group?.id ?? '') === String(groupId)) || null;
}

function ansi(code, text) {
  return `\u001b[${code}m${text}\u001b[0m`;
}

function highlightedLine(text, highlights = [], color = '37') {
  let output = ansi(color, text);
  const sorted = highlights
    .filter((highlight) => highlight?.text)
    .sort((a, b) => text.indexOf(a.text) - text.indexOf(b.text));
  if (!sorted.length) return output;

  output = '';
  let cursor = 0;
  for (const highlight of sorted) {
    const index = text.indexOf(highlight.text, cursor);
    if (index < 0) continue;
    output += ansi(color, text.slice(cursor, index));
    output += ansi(highlight.code || '34;1;4', highlight.text);
    cursor = index + highlight.text.length;
  }
  return output + ansi(color, text.slice(cursor));
}

function box(kind, text, highlights = []) {
  const icon = kind === 'ok' ? '✅' : kind === 'warn' ? '⚠️' : '❌';
  const color = kind === 'ok' ? '32' : kind === 'warn' ? '33' : '31';
  return `\`\`\`ansi\n${ansi(color, icon)} ${highlightedLine(text, highlights)}\n\`\`\``;
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

function findBlacklistEntry(rows, names) {
  const usernames = new Set(names.map(normalizeMatch).filter(Boolean));
  return rows.find((row) => !row.lifted && usernames.has(normalizeMatch(row.username))) || null;
}

function formatBlacklistEndDate(value) {
  const serial = Number(value);
  if (!Number.isFinite(serial)) return String(value || 'unspecified');

  const date = serialToDate(serial);
  const pad = (part) => String(part).padStart(2, '0');
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
}

async function execute(interaction) {
  const irfGroupId = getNumericConfigValue('irf_group_id', 872876);
  const governmentGroupId = getNumericConfigValue('government_group_id', 5248401);
  const mocsGroupId = getNumericConfigValue('mocs_group_id', 10409578);
  await showLoading(interaction);

  const target = String(interaction.options.getString('username') || '').trim();
  let robloxUser;
  try {
    robloxUser = await getRobloxUser(target);
  } catch (err) {
    console.error('Roblox lookup failed:', err);
    return interaction.editReply('Something went wrong looking that user up on Roblox. Please try again in a moment.');
  }

  if (!robloxUser) return interaction.editReply(`${target} does not exist`);

  let userInfo = null;
  let nameHistory = [];
  let groupRoles = [];
  const verificationErrors = [];
  try {
    [userInfo, nameHistory, groupRoles] = await Promise.all([
      getRobloxUserById(robloxUser.id),
      getUsernameHistory(robloxUser.id),
      getUserGroupRoles(robloxUser.id),
    ]);
  } catch (err) {
    console.error('Roblox eligibility lookup failed:', err);
    verificationErrors.push('Roblox account, username history, and group membership could not be fully verified.');
  }

  const irfRole = findGroupRole(groupRoles, irfGroupId);
  const govRole = findGroupRole(groupRoles, governmentGroupId);
  const mocsRole = findGroupRole(groupRoles, mocsGroupId);
  const createdAt = userInfo?.created ? new Date(userInfo.created) : null;
  const accountAgeDays = createdAt && !Number.isNaN(createdAt.getTime()) ? daysSince(createdAt) : null;
  const ageOk = accountAgeDays !== null && accountAgeDays > 60;
  const enemyGroups = loadEnemyGroups();
  const userGroupIds = new Set(groupRoles.map((entry) => Number(entry?.group?.id)).filter(Number.isFinite));
  const enemyGroupMatch = enemyGroups.find((enemy) => userGroupIds.has(enemy.groupId)) || null;

  let blacklisted = null;
  try {
    const blacklistRows = await getMocsBlacklistRows();
    blacklisted = findBlacklistEntry(blacklistRows, [target, robloxUser.name, robloxUser.displayName, ...nameHistory]);
  } catch (err) {
    console.error('MoCS blacklist fetch failed:', err);
    verificationErrors.push('Blacklist status could not be verified.');
  }

  const checks = [
    {
      passed: verificationErrors.length === 0,
      failure: verificationErrors.length ? `Eligibility could not be verified: ${[...new Set(verificationErrors)].join(' ')}` : null,
    },
    {
      passed: !blacklisted,
      failure: blacklisted
        ? `User is Blacklisted from joining the Ministry with following Duration: ${formatBlacklistEndDate(blacklisted.endDate)} and Reason: ${blacklisted.reason || 'No reason provided'}.`
        : null,
    },
    {
      passed: !enemyGroupMatch,
      failure: enemyGroupMatch ? `User is a member of an enemy group: ${enemyGroupMatch.groupName}.` : null,
    },
    { passed: !mocsRole, failure: 'User is already a member of the Ministry of Civil Services.' },
    { passed: Boolean(govRole), failure: 'User is not a member of the Government of the Federation.' },
    { passed: Boolean(irfRole), failure: 'User is not a member of the Imperialist Robloxian Federation.' },
    { passed: ageOk, failure: 'Account is not older than 60 days.' },
  ];
  const eligible = checks.every((check) => check.passed);
  const failures = checks.filter((check) => !check.passed).map((check) => check.failure);
  const warningText = failures.length ? failures.join(' ') : 'No Warnings.';
  const eligibilityText = eligible
    ? 'User is ELIGIBLE to join the Ministry of Civil Services.'
    : 'User is NOT ELIGIBLE to join the Ministry of Civil Services.';

  const warningHighlights = [];
  if (blacklisted) {
    warningHighlights.push({ text: 'Blacklisted', code: '31;1;4' });
    warningHighlights.push({ text: formatBlacklistEndDate(blacklisted.endDate), code: '31;1;4' });
    if (blacklisted.reason) warningHighlights.push({ text: blacklisted.reason, code: '31;1;4' });
  }
  if (enemyGroupMatch) warningHighlights.push({ text: enemyGroupMatch.groupName, code: '31;1;4' });
  if (mocsRole) warningHighlights.push({ text: 'Ministry of Civil Services', code: '34;1;4' });

  const eligibilityHighlights = eligible
    ? [
      { text: 'ELIGIBLE', code: '32;1' },
      { text: 'join the Ministry of Civil Services', code: '35;1;4' },
    ]
    : [{ text: 'NOT ELIGIBLE', code: '31;1' }];

  let avatarUrl = null;
  try {
    avatarUrl = await getAvatarHeadshotUrl(robloxUser.id);
  } catch (err) {
    console.error('Avatar fetch failed:', err);
  }

  const embed = new EmbedBuilder()
    .setColor(eligible ? COLOR_ALLOWED : COLOR_DENIED)
    .setAuthor({ name: 'Citizenship. Integration. Quality.' })
    .setTitle(`Eligibility Information for ${robloxUser.name}`)
    .setDescription('■▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬■')
    .addFields(
      { name: 'Roblox Username', value: `\`${String(robloxUser.name || 'Unknown')}\``, inline: true },
      { name: 'Display Name', value: `\`${String(robloxUser.displayName || 'Unknown')}\``, inline: true },
      { name: 'User ID', value: `\`${String(robloxUser.id || '')}\``, inline: true },
      { name: 'Main Rank', value: irfRole?.role?.name || 'Not in IRF', inline: true },
      { name: 'Government Rank', value: govRole?.role?.name || 'Not in Government', inline: true },
      { name: 'MoCS Rank', value: mocsRole?.role?.name || 'Not In MoCS!', inline: true },
      { name: 'Account Age', value: accountAgeDays === null ? 'Unknown' : `${accountAgeDays} days`, inline: true },
      { name: 'Profile Link', value: `https://www.roblox.com/users/${robloxUser.id}/profile`, inline: false },
      { name: 'Warnings', value: box(failures.length ? 'danger' : 'ok', warningText, warningHighlights), inline: false },
      { name: 'Eligibility', value: box(eligible ? 'ok' : 'danger', eligibilityText, eligibilityHighlights), inline: false },
    )
    .setFooter({ text: 'Citizenship. Integration. Quality.' })
    .setTimestamp();

  if (avatarUrl) embed.setThumbnail(avatarUrl);
  return interaction.editReply({ embeds: [embed] });
}

module.exports = { data, execute, cooldownSeconds: 10, access: 'member' };