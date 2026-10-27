const { google } = require('googleapis');
const { getConfigValue } = require('./configuration');
const { createSheetsClient } = require('../utils/googleSheetsClient');

let sheetsClient = null;
function getClient() {
  if (!sheetsClient) {
    const auth = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
      ? new google.auth.GoogleAuth({
        credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      })
      : process.env.GOOGLE_APPLICATION_CREDENTIALS
        ? new google.auth.GoogleAuth({
          keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
          scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        })
        : process.env.GOOGLE_API_KEY;
    sheetsClient = createSheetsClient(auth);
  }
  return sheetsClient;
}

function normalizeSheetTitle(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

async function resolveSheetTab(requestedTitle, spreadsheetId = getConfigValue('google_autolog_sheet_id')) {
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

  throw new Error(
    `AutoLogs sheet tab was not found. Requested title="${requestedTitle || '(none)'}". Available tabs: ${tabs.map((t) => t.title).join(', ') || '(none)'}`
  );
}

function formatSheetTimestamp(date = new Date()) {
  const d = new Date(date);
  const pad = (value) => String(value).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function buildAutoLogRow(values = []) {
  return values.map((value, index) => {
    if (value === undefined || value === null) return '';
    const text = String(value);
    return index > 0 && /^[\s\u0000]*[=+\-@]/u.test(text) ? `'${text}` : text;
  });
}

async function appendAutoLogRow({
  sheetId,
  tabName,
  values = [],
} = {}) {
  return appendAutoLogRows({ sheetId, tabName, rows: [values] });
}

async function appendAutoLogRows({
  sheetId = getConfigValue('google_autolog_sheet_id'),
  tabName = getConfigValue('google_autolog_sheet_tab'),
  rows = [],
} = {}) {
  if (!sheetId) {
    throw new Error('The AutoLogs spreadsheet is not configured. Set google_autolog_sheet_id in the private MOCS_CONFIG_FILE.');
  }

  const sheets = getClient();
  const resolvedTab = await resolveSheetTab(tabName, sheetId);
  const range = getConfigValue('google_autolog_sheet_range');
  const normalizedRows = rows.map((row) => buildAutoLogRow(row));

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `'${resolvedTab.replace(/'/g, "''")}'!${range}`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: normalizedRows,
    },
  });

  return { sheetId, tabName: resolvedTab, rows: normalizedRows };
}

module.exports = {
  formatSheetTimestamp,
  buildAutoLogRow,
  appendAutoLogRow,
  appendAutoLogRows,
};
