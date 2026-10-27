const { getConfigValue } = require('./configuration');
const { createCache } = require('../utils/cache');
const { createSheetsClient } = require('../utils/googleSheetsClient');

const COL = {
  NAME: 0,
  GROUP_ID: 1,
  CATEGORY: 2,
  NOTES: 3,
  FIRST_RANK_ID: 4,
};

let sheetsClient = null;

function getClient() {
  if (!sheetsClient) {
    sheetsClient = createSheetsClient(process.env.GOOGLE_API_KEY);
  }
  return sheetsClient;
}

const groupDefinitionsCache = createCache('group-definitions', { ttlMs: 60_000, maxEntries: 1 });

function getGroupDefinitions(force = false) {
  return groupDefinitionsCache.wrap('definitions', loadGroupDefinitions, { force });
}

async function loadGroupDefinitions() {
  const sheets = getClient();
  const sheetId = getConfigValue('google_groups_sheet_id');
  const sheetTab = getConfigValue('google_groups_sheet_tab');
  const range = `'${sheetTab.replace(/'/g, "''")}'!A2:E`;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range,
    valueRenderOption: 'UNFORMATTED_VALUE',
    majorDimension: 'ROWS',
  });

  const values = res.data.values || [];

  const defs = values
    .map((row) => {
      const name = String(row[COL.NAME] ?? '').trim();
      const groupId = Number(row[COL.GROUP_ID]);
      const category = String(row[COL.CATEGORY] ?? '').trim();
      const firstRankRaw = row[COL.FIRST_RANK_ID];
      const firstRankId =
        firstRankRaw === '' || firstRankRaw === undefined || firstRankRaw === null
          ? null
          : Number(firstRankRaw);

      return { name, groupId, category, notes: String(row[COL.NOTES] ?? '').trim(), firstRankId };
    })
    .filter((d) => d.name && Number.isFinite(d.groupId));

  console.log(`[groupsSheet] Loaded ${defs.length} group definitions from "${sheetTab}".`);
  return defs;
}

module.exports = { getGroupDefinitions };
