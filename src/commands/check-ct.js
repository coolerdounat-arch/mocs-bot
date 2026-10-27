const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { getRobloxUser, getRobloxUserById, getUsernameHistory, getAvatarHeadshotUrl } = require('../services/roblox');
const { getUserGroupRoles, getGroupRoles } = require('../services/robloxGroups');
const { getQuotaLogRows, getBlacklistRows, normalizeMatch } = require('../services/googleSheets');
const { serialToDate } = require('../utils/format');
const { getNumericConfigValue } = require('../services/configuration');
const { showLoading } = require('../services/loadingScreen');

const COLOR_ALLOWED = 0x00ff00;
const COLOR_LIMITED = 0xffcc00;
const COLOR_DENIED = 0xff0000;

const data = new SlashCommandBuilder()
  .setName('check-ct')
  .setDescription('Check eligibility to take Citizenship Tests')
  .addStringOption((opt) =>
    opt
      .setName('username')
      .setDescription('Roblox username to check (required)')
      .setRequired(true)
  )
  .setIntegrationTypes(0, 1)
  .setContexts(0, 1, 2);

function isHighCitizenRole(roleName) {
  return Boolean(roleName && roleName.toLowerCase().includes('high'));
}

function isLowClassRole(roleName) {
  return Boolean(roleName && roleName.toLowerCase().includes('low class'));
}

function daysBetween(dateA, dateB) {
  return Math.floor((dateA - dateB) / (24 * 60 * 60 * 1000));
}

function findGroupRole(groupRoles, groupId) {
  const wanted = String(groupId);
  return (groupRoles || []).find((entry) => {
    const id = entry?.group?.id ?? entry?.groupId ?? entry?.id;
    return String(id ?? '') === wanted;
  }) || null;
}

function ansi(code, text) {
  return `\u001b[${code}m${text}\u001b[0m`;
}

function warningLine(text, highlights = [], color = '37') {
  let out = ansi(color, text);
  const sorted = highlights
    .filter((h) => h && h.text)
    .sort((a, b) => text.indexOf(a.text) - text.indexOf(b.text));
  if (!sorted.length) return out;
  let cursor = 0;
  out = '';
  for (const h of sorted) {
    const idx = text.indexOf(h.text, cursor);
    if (idx < 0) continue;
    out += ansi(color, text.slice(cursor, idx));
    out += ansi(h.code || '34;1;4', h.text);
    cursor = idx + h.text.length;
  }
  out += ansi(color, text.slice(cursor));
  return out;
}

function warningBox(text, kind = 'danger', highlights = []) {
  const icon = kind === 'ok' ? '✅' : kind === 'warn' ? '⚠️' : '❌';
  const color = kind === 'ok' ? '32' : kind === 'warn' ? '33' : '31';
  return `\`\`\`ansi\n${ansi(color, icon)} ${warningLine(text, highlights, '37')}\n\`\`\``;
}

function eligibilityBox(kind, text, highlights = []) {
  const icon = kind === 'ok' ? '✅' : kind === 'warn' ? '⚠️' : '❌';
  const iconColor = kind === 'ok' ? '32' : kind === 'warn' ? '33' : '31';
  return `\`\`\`ansi\n${ansi(iconColor, icon)} ${warningLine(text, highlights, '37')}\n\`\`\``;
}

function loadEnemyGroups() {
  const csvPath = path.join(__dirname, '../data/enemy-groups.csv');

  if (!fs.existsSync(csvPath)) {
    return [];
  }

  const lines = fs.readFileSync(csvPath, 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);

  if (lines.length <= 1) {
    return [];
  }

  return lines.slice(1).map((line) => {
    const [rawGroupId, ...rest] = line.split(',');
    const groupName = rest.join(',').trim();
    const groupId = Number(rawGroupId);

    if (!Number.isFinite(groupId) || !groupName) {
      return null;
    }

    return { groupId, groupName };
  }).filter(Boolean);
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

  if (!robloxUser) {
    return interaction.editReply(`${target} does not exist`);
  }

  let userInfo;
  let nameHistory = [];
  const verificationErrors = [];
  const [userInfoResult, nameHistoryResult] = await Promise.allSettled([
    getRobloxUserById(robloxUser.id),
    getUsernameHistory(robloxUser.id),
  ]);
  if (userInfoResult.status === 'fulfilled') {
    userInfo = userInfoResult.value;
  } else {
    console.error('Roblox user detail fetch failed:', userInfoResult.reason?.message || userInfoResult.reason);
    verificationErrors.push('Roblox account details could not be verified.');
  }
  if (nameHistoryResult.status === 'fulfilled') {
    nameHistory = nameHistoryResult.value;
  } else {
    console.error('Roblox username history fetch failed:', nameHistoryResult.reason?.message || nameHistoryResult.reason);
    verificationErrors.push('Roblox username history could not be verified.');
  }

  const createdAt = userInfo?.created ? new Date(userInfo.created) : null;
  const accountAgeDays = createdAt ? Math.floor((Date.now() - createdAt.getTime()) / (24 * 60 * 60 * 1000)) : null;
  const ageOk = accountAgeDays !== null && accountAgeDays >= 60;

  let groupRoles = [];
  try {
    groupRoles = await getUserGroupRoles(robloxUser.id);
  } catch (err) {
    console.error('Roblox groups lookup failed:', err);
    verificationErrors.push('Roblox group membership could not be verified.');
  }

  const irfRole = findGroupRole(groupRoles, irfGroupId);
  const inIRF = Boolean(irfRole);
  const mainRank = irfRole ? String(irfRole.role?.name || '') : 'Not in IRF';

  const directMocsRole = findGroupRole(groupRoles, mocsGroupId);
  const inMinistry = Boolean(directMocsRole);

  let allowedTests = [];
  const highClassRank = 40;

  if (!inMinistry) {
    const rn = mainRank.toLowerCase();
    if (isLowClassRole(mainRank)) {
      allowedTests.push('Citizenship Test Only');
    } else if (rn.includes('citizen')) {
      allowedTests.push('High Class Citizenship Test');
    }
  }

  let blacklisted = null;
  try {
    const blacklist = await getBlacklistRows();
    const usernamesToCheck = new Set(
      [target, robloxUser.name, robloxUser.displayName, ...(nameHistory || [])]
        .map(normalizeMatch)
        .filter(Boolean)
    );

    for (const entry of blacklist) {
      if (entry.lifted === true) continue;

      const blacklistedUsername = normalizeMatch(entry.username);
      if (!blacklistedUsername) continue;

      if (usernamesToCheck.has(blacklistedUsername)) {
        blacklisted = entry;
        console.log(`[blacklist] MATCH for ${robloxUser.name}: live row ${entry.sourceRow ?? 'unknown'} contains username "${entry.username}".`);
        break;
      }
    }

    if (!blacklisted) {
      console.log(`[blacklist] No active username match for ${robloxUser.name}. Checked ${blacklist.length} entries against: ${[...usernamesToCheck].join(', ')}`);
    }
  } catch (err) {
    console.error('Blacklist fetch failed:', err);
    verificationErrors.push('Blacklist status could not be verified.');
  }

  let enemyGroupMatch = null;
  let isInEnemy = false;

  try {
    const enemyGroups = loadEnemyGroups();
    const userGroupIds = new Set(
      groupRoles
        .map((g) => Number(g.group?.id))
        .filter((id) => Number.isFinite(id))
    );

    enemyGroupMatch = enemyGroups.find((enemy) => userGroupIds.has(enemy.groupId)) || null;
    isInEnemy = Boolean(enemyGroupMatch);
  } catch (err) {
    console.error('Enemy group CSV fetch failed:', err);
  }

  let lastAttempt = null;
  try {
    const rows = await getQuotaLogRows();
    const userRows = rows
      .filter((r) => String(r.username ?? '').trim().toLowerCase() === String(robloxUser.name ?? '').trim().toLowerCase() && !r.invalidated)
      .sort((a, b) => b.timestampSerial - a.timestampSerial);
    if (userRows.length) lastAttempt = userRows[0];
  } catch (err) {
    console.error('Quota Logs fetch failed:', err);
    verificationErrors.push('Recent Citizenship Test history could not be verified.');
  }

  const now = Date.now();
  let lastAttemptWithin24h = false;
  if (lastAttempt && typeof lastAttempt.timestampSerial === 'number') {
    const lastDate = serialToDate(lastAttempt.timestampSerial);
    lastAttemptWithin24h = now - lastDate.getTime() < 24 * 60 * 60 * 1000;
  }

  let allowedNow = true;
  const reasonNotes = [];
  if (verificationErrors.length) {
    allowedNow = false;
    reasonNotes.push(`Eligibility could not be verified: ${[...new Set(verificationErrors)].join(' ')}`);
  }

  if (!inIRF) {
    allowedNow = false;
    reasonNotes.push('User is not in the IRF main server.');
  }
  if (!ageOk) {
    allowedNow = false;
    reasonNotes.push(`Account is younger than 60 days.`);
  }
  if (blacklisted) {
    allowedNow = false;
    reasonNotes.push(
      `User is Blacklisted from taking CT Tests with following Duration: ${blacklisted.duration || 'unspecified'} and Reason: ${blacklisted.reason || 'No reason provided'} placed by ${blacklisted.placedBy || 'unknown'}.`
    );
  }
  if (isInEnemy && enemyGroupMatch) {
    allowedNow = false;
    reasonNotes.push(`User is a member of an enemy group: ${enemyGroupMatch.groupName}.`);
  }
  if (inMinistry) {
    allowedNow = false;
    reasonNotes.push('User is in the Ministry of Civil Services and cannot take Citizenship Tests.');
  }
  let highPlus = false;
  try {
    if (inIRF && typeof irfRole?.role?.rank === 'number') {
      highPlus = Number(irfRole.role.rank) >= highClassRank;
    } else {
      highPlus = isHighCitizenRole(mainRank);
    }
  } catch (err) {
    console.error('Error determining High+ status:', err);
  }

  if (highPlus && lastAttemptWithin24h) {
    allowedNow = false;
    reasonNotes.push('User is High Class Citizen+ and must wait 24 hours between attempts.');
  }

  const lastPassed = lastAttempt ? String(lastAttempt.passed ?? '').trim().toLowerCase() : '';
  if (lastAttemptWithin24h && lastPassed === 'no') {
    allowedNow = false;
    reasonNotes.push('Last attempt within 24 hours was a fail; retakes are only allowed after 24 hours.');
  }

  let status = 'allowed';

  if (allowedNow && highPlus && !lastAttemptWithin24h) {
    allowedNow = true;
    status = 'HCC';
    reasonNotes.push('User is High Class Citizen or above.');
  }

  if (!allowedNow) status = 'denied';

  let avatarUrl = null;
  let avatarAttachment = null;
  let displayedRanks = [];
  try {
    avatarUrl = await getAvatarHeadshotUrl(robloxUser.id);
    if (avatarUrl) {
      const imageResponse = await fetch(avatarUrl, { signal: AbortSignal.timeout(10_000) });
      if (imageResponse.ok) {
        const contentType = imageResponse.headers.get('content-type') || 'image/png';
        const extension = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'png';
        avatarAttachment = {
          attachment: Buffer.from(await imageResponse.arrayBuffer()),
          name: `roblox-avatar.${extension}`,
        };
      }
    }
  } catch (err) {
    console.error('Avatar fetch failed:', err);
  }
  try {
    const { getDisplayedGroupRanks } = require('../services/groupRanks');
    displayedRanks = await getDisplayedGroupRanks(robloxUser.id);
  } catch (err) {
    console.error('Displayed group ranks lookup failed:', err);
  }

  const directGovernmentRole = findGroupRole(groupRoles, governmentGroupId);
  const governmentField = displayedRanks.find((g) => String(g.label || '').toLowerCase() === 'government rank');
  const governmentRankName = directGovernmentRole?.role?.name || governmentField?.rankName || 'Not in Government';
  const mocsField = displayedRanks.find((g) => String(g.label || '').toLowerCase() === 'mocs rank');
  const mocsRankName = directMocsRole?.role?.name || mocsField?.rankName || 'Not In MoCS!';

  const color = status === 'allowed' ? COLOR_ALLOWED : (status === 'limited' || status === 'HCC') ? COLOR_LIMITED : COLOR_DENIED;
  const tests = allowedTests.length ? allowedTests.join(', ') : 'Any Citizenship Test';

  const eligibilityText = (status === 'allowed' || status === 'HCC')
    ? `User is ELIGIBLE to take ${tests}.`
    : status === 'limited'
      ? `User is ELIGIBLE to take ${tests}, but has a recent attempt.`
      : 'User is NOT ELIGIBLE to take any Citizenship Test.';

  const warningText = reasonNotes.length
    ? reasonNotes.join(' ')
    : 'No Warnings.';

  const warningKind = (!inIRF || (reasonNotes.length && !highPlus && lastAttemptWithin24h))
    ? 'danger'
    : (highPlus && !lastAttemptWithin24h) ? 'warn' : 'ok';
  const eligibilityKind = (status === 'allowed' || status === 'HCC') ? 'ok' : status === 'limited' ? 'warn' : 'danger';

  const warningHighlights = [];
  if (inMinistry) warningHighlights.push({ text: 'Ministry of Civil Services', code: '34;1;4' });
  if (blacklisted) {
    warningHighlights.push({ text: 'Blacklisted', code: '31;1;4' });
    if (blacklisted.duration) warningHighlights.push({ text: blacklisted.duration, code: '31;1;4' });
    if (blacklisted.reason) warningHighlights.push({ text: blacklisted.reason, code: '31;1;4' });
    if (blacklisted.placedBy) warningHighlights.push({ text: blacklisted.placedBy, code: '31;1;4' });
  }
  if (isInEnemy && enemyGroupMatch) {
    warningHighlights.push({ text: enemyGroupMatch.groupName, code: '31;1;4' });
  }

  const eligibilityHighlights = [];
  if (status === 'allowed' || status === 'HCC') {
    eligibilityHighlights.push({ text: 'ELIGIBLE', code: '32;1' });
    if (tests) eligibilityHighlights.push({ text: tests, code: '35;1;4' });
  } else if (status === 'limited') {
    eligibilityHighlights.push({ text: 'ELIGIBLE', code: '33;1' });
    if (tests) eligibilityHighlights.push({ text: tests, code: '35;1;4' });
  } else if (inMinistry) {
    eligibilityHighlights.push({ text: 'Ministry of Civil Service', code: '34;1;4' });
    eligibilityHighlights.push({ text: 'NOT ELIGIBLE', code: '31;1' });
  } else {
    eligibilityHighlights.push({ text: 'NOT ELIGIBLE', code: '31;1' });
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: 'Citizenship. Integration. Quality.' })
    .setTitle(`Eligibility Information for ${robloxUser.name}`)
    .setDescription('■▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬■')
    .addFields(
      {
        name: 'Roblox Username',
        value: `\`${String(robloxUser.name || 'Unknown')}\``,
        inline: true,
      },
      {
        name: 'Display Name',
        value: `\`${String(robloxUser.displayName || 'Unknown')}\``,
        inline: true,
      },
      {
        name: 'User ID',
        value: `\`${String(robloxUser.id || '')}\``,
        inline: true,
      },
      {
        name: 'Main Rank',
        value: String(mainRank || 'Not in IRF'),
        inline: true,
      },
      {
        name: 'Government Rank',
        value: String(governmentRankName),
        inline: true,
      },
      {
        name: 'MoCS Rank',
        value: String(mocsRankName),
        inline: true,
      },
      {
        name: 'Profile Link',
        value: `https://www.roblox.com/users/${robloxUser.id}/profile`,
        inline: false,
      },
      {
        name: 'Warnings',
        value: warningBox(warningText, warningKind, warningHighlights),
        inline: false,
      },
      {
        name: 'Eligibility',
        value: eligibilityBox(eligibilityKind, eligibilityText, eligibilityHighlights),
        inline: false,
      },
    )
    .setFooter({ text: 'Citizenship. Integration. Quality.' })
    .setTimestamp();

  if (avatarAttachment) {
    embed.setThumbnail(`attachment://${avatarAttachment.name}`);
  } else if (avatarUrl) {
    embed.setThumbnail(avatarUrl);
  }

  return interaction.editReply({
    embeds: [embed],
    ...(avatarAttachment ? { files: [avatarAttachment] } : {}),
  });
}

module.exports = { data, execute, cooldownSeconds: 10, access: 'member' };
