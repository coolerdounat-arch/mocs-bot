const SHEETS_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function pad(n) {
  return String(n).padStart(2, '0');
}

function serialToDate(serial) {
  return new Date(SHEETS_EPOCH_UTC_MS + Math.round(serial * MS_PER_DAY));
}

function formatTimestamp(serial) {
  if (typeof serial !== 'number' || Number.isNaN(serial)) return 'Unknown time';
  const d = serialToDate(serial);
  return (
    `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

module.exports = { serialToDate, formatTimestamp };
