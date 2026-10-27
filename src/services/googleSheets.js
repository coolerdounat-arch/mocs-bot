const { SHEET_RANGES } = require('../data/sheet-ranges');
const { getConfigValue, getNumericConfigValue } = require('./configuration');
const { createCache } = require('../utils/cache');
const { createSheetsClient } = require('../utils/googleSheetsClient');

const COL = {
  HOST: 0,
  ACTIVITY: 2,
  DESCRIPTION: 3,
  USERNAME: 7,
  PASSED: 8,
  INVALIDATED: 15,
  TIMESTAMP: 18,
};

const BLACKLIST_SHEET_GID = null;

let sheetsClient = null;
function getClient() {
  if (!sheetsClient) {
    sheetsClient = createSheetsClient(process.env.GOOGLE_API_KEY);
  }
  return sheetsClient;
}

function normalizeSheetTitle(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeMatch(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .trim()
    .toLowerCase();
}

function matchesNameList(value, candidates) {
  const splitNames = (input) => String(input ?? '')
    .split(/[\s,;/|]+/)
    .map(normalizeMatch)
    .filter(Boolean);
  const targetNames = new Set((Array.isArray(candidates) ? candidates : [candidates]).flatMap(splitNames));
  return splitNames(value).some((name) => targetNames.has(name));
}

async function resolveSheetTab(requestedTitle, spreadsheetId, requestedGid = null) {
  const sheets = getClient();
  const requested = normalizeSheetTitle(requestedTitle);
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(title,sheetId,index))',
  });
  const tabs = (meta.data.sheets || []).map((sheet) => sheet.properties).filter(Boolean);

  const exact = requestedTitle ? tabs.find((tab) => tab.title === requestedTitle) : null;
  if (exact) return exact.title;

  const normalized = requested ? tabs.find((tab) => normalizeSheetTitle(tab.title) === requested) : null;
  if (normalized) return normalized.title;

  if (requestedGid !== null && Number.isFinite(requestedGid)) {
    const byGid = tabs.find((tab) => Number(tab.sheetId) === requestedGid);
    if (byGid) return byGid.title;
  }

  throw new Error(
    `Blacklist sheet tab was not found. Requested title="${requestedTitle || '(none)'}", gid=${requestedGid ?? '(none)'}. Available tabs: ${tabs.map((t) => `${t.title} [gid=${t.sheetId}]`).join(', ')}`
  );
}

const CACHE_TTL_MS = 30_000;
const sheetsCache = createCache('google-sheets', { ttlMs: CACHE_TTL_MS, maxEntries: 20 });

function getQuotaLogRows(force = false) {
  return sheetsCache.wrap('quota-log-rows', loadQuotaLogRows, { force });
}

async function loadQuotaLogRows() {
  const sheets = getClient();
  const sheetId = getConfigValue('google_sheet_id');
  const sheetTab = getConfigValue('google_sheet_tab');
  const startRow = getNumericConfigValue('google_sheet_start_row', 11);
  const range = `'${sheetTab.replace(/'/g, "''")}'!E${startRow}:W`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range,
    valueRenderOption: 'UNFORMATTED_VALUE',
    majorDimension: 'ROWS',
  });

  const values = res.data.values || [];
  return values
    .map((row) => ({
      host: String(row[COL.HOST] ?? '').trim(),
      activity: String(row[COL.ACTIVITY] ?? '').trim(),
      description: String(row[COL.DESCRIPTION] ?? '').trim(),
      username: String(row[COL.USERNAME] ?? '').trim(),
      passed: String(row[COL.PASSED] ?? '').trim(),
      invalidated: row[COL.INVALIDATED] === true || normalizeMatch(row[COL.INVALIDATED]) === 'true',
      timestampSerial: typeof row[COL.TIMESTAMP] === 'number' ? row[COL.TIMESTAMP] : null,
    }))
    .filter((r) => r.timestampSerial !== null);
}

function findHeaderRow(values) {
  const wanted = new Set(['lifted', 'username', 'duration', 'reason']);
  const maxScan = Math.min(values.length, 30);
  for (let r = 0; r < maxScan; r += 1) {
    const normalized = new Set((values[r] || []).map(normalizeMatch).filter(Boolean));
    let hits = 0;
    for (const key of wanted) if (normalized.has(key)) hits += 1;
    if (hits >= 3) return r;
  }
  return -1;
}

function buildBlacklistRows(values, firstSheetRow) {
  const headerIndex = findHeaderRow(values);

  let column = {
    lifted: 5,
    username: 6,
    discordId: 7,
    discordTag: 8,
    duration: 9,
    reason: 10,
    placedBy: 14,
  };
  let dataStart = 0;

  if (headerIndex >= 0) {
    const headers = values[headerIndex] || [];
    const locate = (name, fallback) => {
      const idx = headers.findIndex((v) => normalizeMatch(v) === name);
      return idx >= 0 ? idx : fallback;
    };
    column = {
      lifted: locate('lifted', 5),
      username: locate('username', 6),
      discordId: locate('discord id', 7),
      discordTag: locate('discord tag', 8),
      duration: locate('duration', 9),
      reason: locate('reason', 10),
      placedBy: locate('placed by', 14),
    };
    dataStart = headerIndex + 1;
  }

  const rows = [];
  for (let i = dataStart; i < values.length; i += 1) {
    const row = values[i] || [];
    const username = String(row[column.username] ?? '').trim();
    const discordId = String(row[column.discordId] ?? '').trim();
    const discordTag = String(row[column.discordTag] ?? '').trim();
    const duration = String(row[column.duration] ?? '').trim();
    const reason = String(row[column.reason] ?? '').trim();
    const placedBy = String(row[column.placedBy] ?? '').trim();
    const liftedRaw = row[column.lifted];
    const lifted = liftedRaw === true || normalizeMatch(liftedRaw) === 'true' || normalizeMatch(liftedRaw) === 'yes';

    if (!username && !discordId && !discordTag && !duration && !reason && !placedBy) continue;

    rows.push({
      username,
      discordId,
      discordTag,
      lifted,
      duration,
      reason,
      placedBy,
      sourceRow: firstSheetRow + i,
    });
  }

  return rows;
}

function getBlacklistRows(force = false) {
  return sheetsCache.wrap('blacklist-rows', loadBlacklistRows, { force });
}

async function loadBlacklistRows() {
  const sheets = getClient();
  const sheetId = getConfigValue('google_blacklist_sheet_id');
  const sheetTab = getConfigValue('google_blacklist_sheet_tab');
  const resolvedTab = await resolveSheetTab(sheetTab, sheetId, BLACKLIST_SHEET_GID);

  const range = `'${resolvedTab.replace(/'/g, "''")}'!A1:Z`;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range,
    valueRenderOption: 'UNFORMATTED_VALUE',
    majorDimension: 'ROWS',
  });

  const values = res.data.values || [];
  const rows = buildBlacklistRows(values, 1);

  console.log(`[blacklist] Loaded ${rows.length} non-empty entries from "${resolvedTab}" in spreadsheet ${sheetId}.`);
  return rows;
}

function getMocsBlacklistRows(force = false) {
  return sheetsCache.wrap('mocs-blacklist-rows', loadMocsBlacklistRows, { force });
}

async function loadMocsBlacklistRows() {
  const sheets = getClient();
  const sheetId = getConfigValue('google_blacklist_sheet_id');
  const startRow = getNumericConfigValue('google_blacklist_start_row', 11);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `'MoCS'!D${startRow}:I`,
    valueRenderOption: 'UNFORMATTED_VALUE',
    majorDimension: 'ROWS',
  });

  const rows = (res.data.values || [])
    .map((row, index) => ({
      username: String(row[0] ?? '').trim(),
      reason: String(row[1] ?? '').trim(),
      endDate: String(row[4] ?? '').trim(),
      lifted: row[5] === true || normalizeMatch(row[5]) === 'true' || normalizeMatch(row[5]) === 'yes',
      sourceRow: startRow + index,
    }))
    .filter((row) => row.username || row.reason || row.endDate || row.lifted);

  console.log(`[blacklist] Loaded ${rows.length} entries from the MoCS table.`);
  return rows;
}

const QP_RANGE_DEFS = [
  ...Object.entries(SHEET_RANGES.departments).flatMap(([key, ranges]) => [
    { key, kind: 'entries', range: ranges.entries, noticeRange: ranges.notice, qpIdx: ranges.qpIndex, statusIdx: ranges.noticeIndex, spreadsheetId: ranges.spreadsheetId },
    { key, kind: 'admins', range: ranges.admins, spreadsheetId: ranges.spreadsheetId },
    ...(ranges.novice ? [{ key, kind: 'novice', range: ranges.novice, spreadsheetId: ranges.spreadsheetId }] : []),
  ]),
];

function getQuotaPointEntries(force = false) {
  return sheetsCache.wrap('quota-point-entries', loadQuotaPointEntries, { force });
}

async function loadQuotaPointEntries() {
  const sheets = getClient();
  const results = {
    fsd: { entries: [], admins: [], coverWeekStart: null },
    ced: { entries: [], admins: [], coverWeekStart: null },
    ia: { entries: [], admins: [], coverWeekStart: null },
    fsa: { entries: [], admins: [], novice: [], coverWeekStart: null },
  };
  const failedRanges = [];

  const readRange = (spreadsheetId, range) => sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: 'UNFORMATTED_VALUE',
    majorDimension: 'ROWS',
  });

  const loadCoverWeekStart = async () => {
    try {
      const coverRes = await readRange(SHEET_RANGES.mocsCoverWeekStart.spreadsheetId, SHEET_RANGES.mocsCoverWeekStart.range);
      const coverValue = coverRes.data.values?.[0]?.[0] ?? null;
      for (const bucket of Object.values(results)) bucket.coverWeekStart = coverValue;
    } catch (err) {
      console.error(`[googleSheets] Failed to read ${SHEET_RANGES.mocsCoverWeekStart.range}:`, err.message || err);
      failedRanges.push(SHEET_RANGES.mocsCoverWeekStart.range);
    }
  };

  const loadRange = async (def) => {
    try {
      const [res, noticeRes] = await Promise.all([
        readRange(def.spreadsheetId, def.range),
        def.kind === 'entries' && def.noticeRange ? readRange(def.spreadsheetId, def.noticeRange) : null,
      ]);
      const values = res.data.values || [];

      if (def.kind === 'entries') {
        const noticeValues = noticeRes?.data.values || [];
        for (const [rowIndex, row] of values.entries()) {
          const name = String(row[0] ?? '').trim();
          if (!name) continue;
          const qpRaw = row[def.qpIdx];
          const raw = String(qpRaw ?? '').trim();
          const qpNum = typeof qpRaw === 'number' ? qpRaw : Number(raw);
          results[def.key].entries.push({
            name,
            raw,
            qp: raw !== '' && Number.isFinite(qpNum) ? qpNum : null,
            statusOrDate: def.noticeRange
              ? noticeValues[rowIndex]?.[0] ?? ''
              : row[def.statusIdx] ?? '',
          });
        }
      } else {
        const target = def.kind === 'novice' ? results[def.key].novice : results[def.key].admins;
        for (const row of values) {
          const name = String(row[0] ?? '').trim();
          if (name) target.push(name);
        }
      }
    } catch (err) {
      console.error(`[googleSheets] Failed to read range ${def.range}:`, err.message || err);
      failedRanges.push(def.range);
    }
  };

  await Promise.all([loadCoverWeekStart(), ...QP_RANGE_DEFS.map(loadRange)]);

  if (failedRanges.length) {
    throw new Error(`Quota data is incomplete; failed to read: ${failedRanges.join(', ')}`);
  }

  return results;
}

module.exports = {
  getQuotaLogRows,
  getBlacklistRows,
  getMocsBlacklistRows,
  normalizeMatch,
  matchesNameList,
  getQuotaPointEntries,
};
