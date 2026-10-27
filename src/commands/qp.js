const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getQuotaPointEntries } = require('../services/googleSheets');
const { getDisplayedGroupRanks } = require('../services/groupRanks');
const { getAvatarHeadshotUrl, getRobloxUser } = require('../services/roblox');
const { getLinkedUser } = require('../services/linkedUsers');
const { serialToDate } = require('../utils/format');
const { showLoading } = require('../services/loadingScreen');

const data = new SlashCommandBuilder()
  .setName('qp')
  .setDescription('Show your quota points for this week (or for an optional username)')
  .addStringOption((opt) => opt.setName('username').setDescription('Roblox username to check (optional)').setRequired(false))
  .setIntegrationTypes(0, 1)
  .setContexts(0, 1, 2);

const ROLE_MINISTERIAL_HIGH_COMMAND = '838369220655317043';
const ROLE_GOVERNMENT_COMMAND = '1281742649333649419';

const MOCS_RANK_HIERARCHY = [
  'first chief',
  'deputy minister',
  'minister',
  'deputy prime minister',
  'prime minister',
  'group holder',
];
const MOCS_RANK_EXEMPT_CUTOFF = MOCS_RANK_HIERARCHY.indexOf('first chief');
const GOVERNMENT_COMMAND_CUTOFF = MOCS_RANK_HIERARCHY.indexOf('deputy prime minister');

const NOVICE_SERVICEMAN_RANK = 'novice serviceman';

const HIGH_COMMAND_NO_QUOTA_MESSAGE = 'You are Ministerial High Command and therefore have no Quota.';
const GOVERNMENT_COMMAND_NO_QUOTA_MESSAGE = 'You are Government Command and therefore have no Quota.';
const NOT_YET_ADDED_MESSAGE = 'QP command will be available once you reach Junior Civil Serviceman and have been added to the database.';
const SECONDARY_MESSAGE = 'This department is set as secondary and therefore have no quota.';
const CSIA_MESSAGE = 'You are in the CSIA and therefore have no quota.';
const WEEK_EXEMPT_MESSAGE = 'You are exempt from quota for this week.';
const RANKUP_NOTES = {
  130: 'Rank-up requirement: Pass a patrol evaluation.',
  140: 'Rank-up requirement: Pass either a Public Citizenship Test or a Recruitment Session evaluation.',
  150: 'Rank-up requirement: Pass a Ministry of Education application and request it in #roles-rank-request.',
  160: 'Rank-up requirement: Pass the Ministry of Education student pathway.',
  170: 'Rank-up requirement: Be a Petty Service Officer for one week and reach 10 QP or more.',
  180: 'Rank-up requirement: Be handpicked by Ministerial Command.',
};

const DEPARTMENTS = [
  { key: 'fsd', label: 'FSD' },
  { key: 'fsa', label: 'FSA' },
];

function normalize(s) {
  return String(s ?? '').trim().toLowerCase();
}

function rowMatchesCell(cellName, target) {
  if (!cellName || !target) return false;
  const parts = String(cellName).split(',').map((p) => p.trim().toLowerCase()).filter(Boolean);
  return parts.includes(String(target).trim().toLowerCase());
}

function nameInList(list, target) {
  const t = normalize(target);
  return (list || []).some((name) => rowMatchesCell(name, t) || normalize(name) === t);
}

function findEntry(list, target) {
  const t = normalize(target);
  for (const entry of list || []) {
    if (rowMatchesCell(entry.name, t) || normalize(entry.name) === t) return entry;
  }
  return null;
}

function isMoE(rawValue) {
  return normalize(rawValue) === 'moe';
}

function mocsRankAtLeast(rankName, cutoffIdx) {
  const idx = MOCS_RANK_HIERARCHY.indexOf(normalize(rankName));
  return idx !== -1 && idx >= cutoffIdx;
}

function isNoviceServiceman(rankName) {
  return normalize(rankName) === NOVICE_SERVICEMAN_RANK;
}

function parseSheetDate(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return serialToDate(value);
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(text)) {
    const [day, month, year] = text.split('/').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfWeek(date) {
  const day = date.getUTCDay() || 7;
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - day + 1);
  monday.setUTCHours(0, 0, 0, 0);
  return monday;
}

function getQuotaRule(statusOrDate, coverWeekStart) {
  if (normalize(statusOrDate) === 'secondary') {
    return { display: 'Secondary', note: SECONDARY_MESSAGE };
  }
  if (normalize(statusOrDate) === 'csia') {
    return { display: 'CSIA', note: CSIA_MESSAGE };
  }

  const date = parseSheetDate(statusOrDate);
  const coverDate = parseSheetDate(coverWeekStart);
  if (!statusOrDate || !String(statusOrDate).trim()) return { requiredQP: 5 };
  if (!date || !coverDate || startOfWeek(date).getTime() !== startOfWeek(coverDate).getTime()) {
    return { requiredQP: 5, exempt: true, note: WEEK_EXEMPT_MESSAGE };
  }

  const day = date.getUTCDay();
  if (day === 0 || day === 6) return { requiredQP: 5, exempt: true, note: WEEK_EXEMPT_MESSAGE };
  if (day === 1 || day === 2) return { requiredQP: 5 };
  if (day === 3) return { requiredQP: 4 };
  if (day === 4) return { requiredQP: 3 };
  return { requiredQP: 2 };
}

function buildMsgFor(qp, requiredQP = 5, rankId = null) {
  if (qp < requiredQP) {
    const diff = requiredQP - qp;
    return `Please gain ${diff} more QP by Sunday to avoid being striked.`;
  }
  if (rankId > 180) {
    return 'Congratulations! You have successfully reached your Minimum Quota this week.';
  }
  if (qp >= requiredQP && qp < 10) {
    const diff = 10 - qp;
    return rankId >= 130 && rankId <= 180
    ? 'Congratulations! You have reached your Minimum Quota this week.'
      : `Congratulations! You have reached your Minimum Quota this week. If you obtain ${diff} more QP, you can gain a Promotion.`;
  }
  if (qp >= 10 && qp < 20) {
    const diff = 20 - qp;
    return rankId === 120
    ? 'You have successfully reached the QP threshold for consideration for one promotion. A double promotion is not available at this rank.'
      : rankId >= 130 && rankId <= 180
      ? 'You have successfully reached the QP threshold for consideration for one promotion.'
      : `You have successfully reached the level of QP for One Promotion. If you obtain ${diff} more QP, you can get Double Promotion.`;
  }
  return rankId === 120
    ? 'Congratulations! You have successfully reached the QP threshold for consideration for a promotion. A double promotion is not available at this rank.'
    : rankId >= 130 && rankId <= 180
    ? 'Congratulations! You have successfully reached the QP threshold for consideration for a promotion.'
    : 'Congratulations! You have successfully reached the QP value for a double promotion.';
}

function resolveDepartment(qpData, deptKey, deptLabel, target, rankId) {
  const bucket = qpData[deptKey] || { entries: [], admins: [] };

  if (nameInList(bucket.admins, target)) {
    return {
      display: 'Administration',
      note: `You are ${deptLabel} Administration and therefore have no Quota.`,
    };
  }

  const entry = findEntry(bucket.entries, target);
  if (!entry) return null;

  if (isMoE(entry.raw)) {
    return {
      display: 'MoE',
      note: `You are exempt from QP requirements for ${deptLabel}.`,
    };
  }

  const quotaRule = getQuotaRule(entry.statusOrDate, bucket.coverWeekStart);
  if (quotaRule.display) return { display: quotaRule.display, note: quotaRule.note };
  if (quotaRule.exempt) return { display: String(entry.qp ?? 0), note: quotaRule.note };

  const qp = entry.qp !== null ? entry.qp : 0;
  const rankupNote = RANKUP_NOTES[rankId] || '';
  return {
    display: String(qp),
    note: [buildMsgFor(qp, quotaRule.requiredQP, rankId), rankupNote].filter(Boolean).join('\n'),
  };
}

async function execute(interaction) {
  const provided = interaction.options.getString('username');
  let roleBasedExemption = null;

  if (!provided) {
    const memberRoles = interaction.member?.roles?.cache;
    if (memberRoles?.has(ROLE_GOVERNMENT_COMMAND)) {
      roleBasedExemption = {
        rankName: 'Government Command',
        message: GOVERNMENT_COMMAND_NO_QUOTA_MESSAGE,
      };
    } else if (memberRoles?.has(ROLE_MINISTERIAL_HIGH_COMMAND)) {
      roleBasedExemption = {
        rankName: 'Ministerial High Command',
        message: HIGH_COMMAND_NO_QUOTA_MESSAGE,
      };
    }
  }

  await showLoading(interaction);

  const linkedUser = provided ? null : getLinkedUser(interaction.user.id);
  const target = provided
    ? String(provided).trim()
    : (linkedUser?.robloxUsername || interaction.member?.displayName || interaction.user.username || '').trim();
  if (!target) return interaction.editReply('No username provided and could not determine your display name.');

  if (roleBasedExemption) {
    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle(`${target} - Quota Points`)
      .setDescription(`**MoCS Rank:** ${roleBasedExemption.rankName}\n\n${roleBasedExemption.message}`)
      .setFooter({ text: 'Citizenship. Integration. Quality.' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }

  let qpData;
  try {
    qpData = await getQuotaPointEntries();
  } catch (err) {
    console.error('Failed to fetch QP entries:', err);
    return interaction.editReply('Something went wrong fetching QP data.');
  }
  let avatarUrl = null;
  let displayedRanks = [];
  try {
    const robloxUser = await getRobloxUser(target);
    if (robloxUser) {
      try { avatarUrl = await getAvatarHeadshotUrl(robloxUser.id); } catch {}
      try { displayedRanks = await getDisplayedGroupRanks(robloxUser.id); } catch {}
    }
  } catch (err) {
   
  }

  const mocsField = (displayedRanks || []).find((g) => String(g.label || '').toLowerCase() === 'mocs rank') || null;
  const mocsRankName = mocsField ? mocsField.rankName : 'Not In MoCS!';
  const mocsRankId = Number(mocsField?.rank);

  const hasGovernmentCommandRank = mocsRankAtLeast(mocsRankName, GOVERNMENT_COMMAND_CUTOFF);
  const hasHighCommandRank = mocsRankAtLeast(mocsRankName, MOCS_RANK_EXEMPT_CUTOFF);
  const isNovice = isNoviceServiceman(mocsRankName);
  const fsaNovice = qpData.fsa?.novice || [];
  const isInFSANovice = nameInList(fsaNovice, target);

  const deptResults = DEPARTMENTS
    .map(({ key, label }) => {
      const info = resolveDepartment(qpData, key, label, target, mocsRankId);
      if (label === 'FSA' && info && info.display === '0') {
        return { label, info: { ...info, display: 'N/A' } };
      }
      return { label, info };
    })
    .filter((d) => d.info);

  const descriptionLines = [`**MoCS Rank:** ${mocsRankName}`];
  if (deptResults.length) {
    descriptionLines.push('');
    for (const { label, info } of deptResults) {
      descriptionLines.push(`**${label} QP:** \`${info.display}\``);
      if (info.note && label !== 'FSA') descriptionLines.push(info.note);
    }
  } else if (hasGovernmentCommandRank) {
    descriptionLines.push('');
    descriptionLines.push(GOVERNMENT_COMMAND_NO_QUOTA_MESSAGE);
  } else if (hasHighCommandRank) {
    descriptionLines.push('');
    descriptionLines.push(HIGH_COMMAND_NO_QUOTA_MESSAGE);
  } else if (isInFSANovice) {
    descriptionLines.push('');
    descriptionLines.push(NOT_YET_ADDED_MESSAGE);
  } else if (isNovice) {
    descriptionLines.push('');
    descriptionLines.push(NOT_YET_ADDED_MESSAGE);
  } else {
    descriptionLines.push('');
    descriptionLines.push('Not found in any Database (FSD or FSA).');
  }
  const description = descriptionLines.join('\n');

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`${target} - Quota Points`)
    .setDescription(description)
    .setThumbnail(avatarUrl || undefined)
    .setFooter({ text: 'Citizenship. Integration. Quality.' })
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}

module.exports = { data, execute, cooldownSeconds: 10, access: 'member' };
