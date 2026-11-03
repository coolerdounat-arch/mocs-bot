const assert = require('node:assert/strict');
const { test } = require('node:test');
const { redactSecrets, toSafeGoogleError } = require('../src/utils/googleSheetsClient');

test('Google errors keep the status but never the API key or tokens', () => {
  const key = `AIza${'x'.repeat(35)}`;
  const raw = Object.assign(new Error(`Requested entity was not found. https://sheets.googleapis.com/v4/spreadsheets/abc?fields=x&key=${key}`), {
    code: 404,
    response: { status: 404, config: { url: `https://sheets.googleapis.com/?key=${key}` } },
  });
  const safe = toSafeGoogleError(raw);
  assert.equal(safe.status, 404);
  assert.match(safe.message, /^Google Sheets request failed \(404\): Requested entity was not found\./);
  assert.doesNotMatch(safe.message, /AIza/);
  assert.equal(safe.response, undefined);
  assert.equal(redactSecrets('Authorization: Bearer ya29.secret'), 'Authorization: Bearer [redacted]');
});
