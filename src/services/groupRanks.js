const fs = require('fs');
const path = require('path');
const { getGroupDefinitions } = require('./groupsSheet');
const { getUserGroupRoles } = require('./robloxGroups');

const LABELS_CSV = path.join(__dirname, '..', 'data', 'group-rank-labels.csv');

function loadRankLabelMappings() {
  const text = fs.readFileSync(LABELS_CSV, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const parseLine = (line) => {
    const out = [];
    let value = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') {
          value += '"';
          i += 1;
        } else {
          quoted = !quoted;
        }
      } else if (ch === ',' && !quoted) {
        out.push(value);
        value = '';
      } else {
        value += ch;
      }
    }
    out.push(value);
    return out;
  };

  const headers = parseLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseLine(line);
    const row = Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']));
    return {
      sourceName: row.source_name.trim(),
      displayLabel: row.display_label.trim(),
      category: row.category.trim().toLowerCase(),
      sortOrder: Number(row.sort_order) || 0,
    };
  }).filter((r) => r.sourceName && r.displayLabel);
}

const RANK_LABEL_MAPPINGS = loadRankLabelMappings();

function normalizeGroupName(groupName) {
  const raw = String(groupName || '').trim();
  const parts = raw.split('|');
  return (parts.length > 1 ? parts.slice(1).join('|') : raw).trim();
}

function findRankLabel(groupName) {
  const normalized = normalizeGroupName(groupName);

  const exact = RANK_LABEL_MAPPINGS.find(
    (m) => normalized.toLowerCase() === m.sourceName.toLowerCase()
  );
  if (exact) return exact;

  return RANK_LABEL_MAPPINGS.find(
    (m) => normalized.toLowerCase().includes(m.sourceName.toLowerCase())
  ) || null;
}

function formatGroupLabel(groupName) {
  const mapping = findRankLabel(groupName);
  if (mapping) return mapping.displayLabel;

  const base = normalizeGroupName(groupName);
  return `${base} Rank`;
}

function getBottomRankOrder(def, labelMapping) {
  const category = String(def.category || '').toLowerCase();
  const mappedCategory = labelMapping?.category || category;

  if (mappedCategory === 'main') return 100;
  if (mappedCategory === 'gov') return 101;
  if (mappedCategory === 'mil') return 102;
  return labelMapping?.sortOrder || 0;
}

async function getDisplayedGroupRanks(robloxUserId) {
  const [groupDefs, userRoles] = await Promise.all([
    getGroupDefinitions(),
    getUserGroupRoles(robloxUserId),
  ]);

  const roleByGroupId = new Map(userRoles.map((r) => [r.group.id, r.role]));

  const results = [];
  for (const def of groupDefs) {
    const category = String(def.category || '').toLowerCase();
    const mapping = findRankLabel(def.name);

    const effectiveCategory = category || 'other';

    const isDesignatedMilitary = normalizeGroupName(def.name).toLowerCase() === 'imperialist robloxian military';
    if (effectiveCategory === 'mil' && !isDesignatedMilitary) continue;

    if (!['main', 'gov', 'mil'].includes(effectiveCategory)) continue;

    const role = roleByGroupId.get(def.groupId);
    if (!role) continue;

    if (def.firstRankId !== null && !(role.rank > def.firstRankId)) continue;

    results.push({
      label: mapping?.displayLabel || formatGroupLabel(def.name),
      rankName: role.name,
      rank: role.rank,
      groupName: def.name,
      category: effectiveCategory,
      sortOrder: getBottomRankOrder(def, mapping),
    });
  }

  results.sort((a, b) => {
    const aBottom = a.category === 'main' || a.category === 'gov' || a.category === 'mil';
    const bBottom = b.category === 'main' || b.category === 'gov' || b.category === 'mil';

    if (aBottom !== bBottom) return aBottom ? 1 : -1;

    if (aBottom && bBottom) {
      const order = { main: 0, gov: 1, mil: 2 };
      return (order[a.category] ?? 99) - (order[b.category] ?? 99);
    }

    return (a.sortOrder - b.sortOrder) || a.label.localeCompare(b.label);
  });

  console.log(
    `[groupRanks] User is in ${userRoles.length} Roblox group(s); ${results.length} shown after category/rank filtering.`
  );

  return results;
}

module.exports = { getDisplayedGroupRanks, formatGroupLabel };
