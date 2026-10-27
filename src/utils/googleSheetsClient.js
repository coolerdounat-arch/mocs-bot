const { google } = require('googleapis');

function redactSecrets(text) {
  return String(text)
    .replace(/([?&](?:key|access_token)=)[^&\s'"]+/gi, '$1[redacted]')
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted]')
    .replace(/(Bearer\s+)[^\s'"]+/gi, '$1[redacted]');
}

function toSafeGoogleError(error) {
  const status = error?.status ?? error?.response?.status ?? (Number.isInteger(error?.code) ? error.code : undefined);
  const safeError = new Error(`Google Sheets request failed${status ? ` (${status})` : ''}: ${redactSecrets(error?.message || error)}`);
  safeError.status = status;
  return safeError;
}

function guard(method, target) {
  return async (...args) => {
    try {
      return await method.apply(target, args);
    } catch (error) {
      throw toSafeGoogleError(error);
    }
  };
}

function createSheetsClient(auth) {
  const { spreadsheets } = google.sheets({ version: 'v4', auth });
  return {
    spreadsheets: {
      get: guard(spreadsheets.get, spreadsheets),
      values: {
        get: guard(spreadsheets.values.get, spreadsheets.values),
        append: guard(spreadsheets.values.append, spreadsheets.values),
      },
    },
  };
}

module.exports = { createSheetsClient, redactSecrets, toSafeGoogleError };
