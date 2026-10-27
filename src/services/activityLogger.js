const { getLinkedUser } = require('./linkedUsers');
const { getUserGroupRoles } = require('./robloxGroups');
const { formatSheetTimestamp, appendAutoLogRows } = require('./autoLogs');
const { getNumericConfigValue } = require('./configuration');

const MINIMUM_MOCS_RANK = 50;

function getMocsGroupId() {
  return getNumericConfigValue('mocs_group_id', 10409578);
}

function getMocsRankFromGroups(groups = []) {
  return (groups || []).find((entry) => Number(entry?.group?.id) === getMocsGroupId()) || null;
}

function getMinimumRankError(minimumRank) {
  if (minimumRank <= 1) return 'Only members of the MoCS Roblox group may use this command.';

  const rankNames = {
    20: 'Novice Civil Serviceman (20)',
    170: 'Petty Service Officer (170)',
  };

  if (rankNames[minimumRank]) {
    return `Only MoCS members ranked at least ${rankNames[minimumRank]} may use this command.`;
  }

  return 'Only MoCS members ranked above Junior Civil Serviceman may use this command.';
}

async function getLinkedMocsContext(discordId, minimumRank = MINIMUM_MOCS_RANK) {
  const linkedUser = getLinkedUser(discordId);
  if (!linkedUser || !(linkedUser.robloxUsername || linkedUser.robloxId)) {
    return { error: 'Your Discord account is not linked to a Roblox account yet. Please use /verify first.' };
  }

  const userGroups = await getUserGroupRoles(Number(linkedUser.robloxId));
  const mocsRole = getMocsRankFromGroups(userGroups);
  const rankId = Number(mocsRole?.role?.rank);
  if (!mocsRole || !Number.isFinite(rankId) || rankId < minimumRank) {
    return { error: getMinimumRankError(minimumRank) };
  }

  return {
    linkedUser,
    robloxUsername: linkedUser.robloxUsername || linkedUser.robloxId,
    rank: mocsRole.role.name,
  };
}

function buildActivityRow({
  timestamp = formatSheetTimestamp(),
  robloxUsername,
  rank,
  activity,
  description = '',
  duration = '',
  stayedUntilEnd = '',
  attendee = '',
  passed = '',
  proof = '',
} = {}) {
  return [
    timestamp,
    robloxUsername,
    rank,
    activity,
    description,
    duration,
    '',
    '',
    stayedUntilEnd,
    attendee,
    passed,
    proof,
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ];
}

module.exports = {
  getMocsGroupId,
  MINIMUM_MOCS_RANK,
  getMocsRankFromGroups,
  getLinkedMocsContext,
  buildActivityRow,
  appendAutoLogRows,
};
