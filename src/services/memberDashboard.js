const { getQuotaLogRows, getQuotaPointEntries, normalizeMatch, matchesNameList } = require('./googleSheets');
const { getDisplayedGroupRanks } = require('./groupRanks');
const { getRobloxUserById, getAvatarHeadshotUrl } = require('./roblox');
const { formatTimestamp } = require('../utils/format');
const { version: botVersion } = require('../../package.json');

const DEPARTMENTS = [
  { key: 'fsd', label: 'FSD' },
  { key: 'fsa', label: 'FSA' },
];

function getDepartmentPoints(qpData, department, names) {
  const bucket = qpData[department.key] || { entries: [], admins: [], novice: [] };
  if ((bucket.admins || []).some((name) => matchesNameList(name, names))) {
    return { department: department.label, status: 'Administration', points: null };
  }

  const entry = (bucket.entries || []).find((item) => matchesNameList(item.name, names));
  if (!entry && department.key === 'fsa' && (bucket.novice || []).some((name) => matchesNameList(name, names))) {
    return { department: department.label, status: 'Novice program', points: null };
  }
  if (!entry) return null;

  const raw = normalizeMatch(entry.raw);
  const status = normalizeMatch(entry.statusOrDate);
  if (raw === 'moe') return { department: department.label, status: 'MoE exempt', points: null };
  if (status === 'secondary') return { department: department.label, status: 'Secondary', points: null };
  if (status === 'csia') return { department: department.label, status: 'CSIA', points: null };
  if (department.key === 'fsa' && Number(entry.qp || 0) === 0) {
    return { department: department.label, status: 'N/A', points: null };
  }

  return { department: department.label, status: 'Active', points: entry.qp ?? 0 };
}

function getRecentActivity(rows, field, names) {
  return rows
    .filter((row) => !row.invalidated && matchesNameList(row[field], names))
    .sort((left, right) => right.timestampSerial - left.timestampSerial)
    .slice(0, 5)
    .map((row) => ({
      activity: row.activity,
      description: row.description,
      host: field === 'username' ? row.host : '',
      date: formatTimestamp(row.timestampSerial),
      passed: ['true', 'yes'].includes(normalizeMatch(row.passed)),
    }));
}

function getBotRuntime(client) {
  return {
    online: typeof client.isReady === 'function' && client.isReady(),
    uptimeSeconds: Math.floor(process.uptime()),
    latencyMs: Number.isFinite(client.ws?.ping) && client.ws.ping >= 0 ? Math.round(client.ws.ping) : null,
    memoryBytes: process.memoryUsage().rss,
    version: botVersion,
  };
}

async function getMemberDashboard(linkedUser, client) {
  let profile = {
    id: linkedUser.robloxId,
    username: linkedUser.robloxUsername,
    displayName: linkedUser.robloxUsername,
    created: null,
    avatarUrl: null,
  };
  let profileAvailable = true;

  const [robloxResult, avatarResult] = await Promise.allSettled([
    getRobloxUserById(linkedUser.robloxId),
    getAvatarHeadshotUrl(linkedUser.robloxId),
  ]);
  if (robloxResult.status === 'fulfilled') {
    const robloxUser = robloxResult.value;
    profile = {
      id: String(robloxUser.id || linkedUser.robloxId),
      username: String(robloxUser.name || linkedUser.robloxUsername),
      displayName: String(robloxUser.displayName || robloxUser.name || linkedUser.robloxUsername),
      created: robloxUser.created || null,
      avatarUrl: avatarResult.status === 'fulfilled' ? avatarResult.value : null,
    };
  } else {
    profileAvailable = false;
    if (avatarResult.status === 'fulfilled') profile.avatarUrl = avatarResult.value;
    console.warn('[member-dashboard] Roblox profile lookup failed:', robloxResult.reason?.message || robloxResult.reason);
  }
  if (avatarResult.status === 'rejected') {
    console.warn('[member-dashboard] Roblox avatar lookup failed:', avatarResult.reason?.message || avatarResult.reason);
  }

  const names = [...new Set([profile.username, linkedUser.robloxUsername].filter(Boolean))];
  const [ranksResult, quotaResult, logsResult] = await Promise.allSettled([
    getDisplayedGroupRanks(linkedUser.robloxId),
    getQuotaPointEntries(),
    getQuotaLogRows(),
  ]);

  const ranksAvailable = ranksResult.status === 'fulfilled';
  const quotaAvailable = quotaResult.status === 'fulfilled';
  const activityAvailable = logsResult.status === 'fulfilled';
  if (!ranksAvailable) console.warn('[member-dashboard] Group rank lookup failed:', ranksResult.reason?.message || ranksResult.reason);
  if (!quotaAvailable) console.warn('[member-dashboard] Quota lookup failed:', quotaResult.reason?.message || quotaResult.reason);
  if (!activityAvailable) console.warn('[member-dashboard] Activity lookup failed:', logsResult.reason?.message || logsResult.reason);

  const qpData = quotaAvailable ? quotaResult.value : {};
  const rows = activityAvailable ? logsResult.value : [];
  return {
    profile,
    runtime: getBotRuntime(client),
    ranks: ranksAvailable ? ranksResult.value.map(({ label, rankName, groupName }) => ({ label, rankName, groupName })) : [],
    quota: quotaAvailable ? DEPARTMENTS.map((department) => getDepartmentPoints(qpData, department, names)).filter(Boolean) : [],
    attended: activityAvailable ? getRecentActivity(rows, 'username', names) : [],
    hosted: activityAvailable ? getRecentActivity(rows, 'host', names) : [],
    availability: {
      profile: profileAvailable,
      ranks: ranksAvailable,
      quota: quotaAvailable,
      activity: activityAvailable,
    },
  };
}

module.exports = { getMemberDashboard };