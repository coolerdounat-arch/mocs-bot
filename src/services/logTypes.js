const fs = require('fs');
const path = require('path');

const { createCache } = require('../utils/cache');

const LOG_TYPES_FILE = path.join(__dirname, '..', 'data', 'log-types.csv');
const logTypesCache = createCache('log-types', { ttlMs: 60 * 60_000, maxEntries: 4 });

function readLogTypes() {
  const stats = fs.statSync(LOG_TYPES_FILE);
  const key = `${stats.ino}:${stats.size}:${stats.mtimeMs}`;
  const cached = logTypesCache.get(key);
  if (cached) return cached;
  logTypesCache.clear();
  return logTypesCache.set(key, parseLogTypes()).map((entry) => ({ ...entry }));
}

function parseLogTypes() {
  const lines = fs.readFileSync(LOG_TYPES_FILE, 'utf8')
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line) => {
    const [command, logType, minimumRank] = line.split(',').map((value) => value.trim());
    return { command, logType, minimumRank: Number(minimumRank) };
  });
}

function getLogTypes(command) {
  return readLogTypes().filter((entry) => entry.command === command && entry.logType);
}

function getLogTypeChoices(command) {
  return getLogTypes(command).map(({ logType }) => ({ name: logType, value: logType }));
}

function getMinimumRank(command, logType, fallback = 50) {
  const entry = getLogTypes(command).find(({ logType: value }) => value === logType);
  return entry && Number.isFinite(entry.minimumRank) ? entry.minimumRank : fallback;
}

module.exports = {
  LOG_TYPES_FILE,
  getLogTypes,
  getLogTypeChoices,
  getMinimumRank,
};