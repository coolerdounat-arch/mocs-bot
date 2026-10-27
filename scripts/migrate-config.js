require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getConfigFilePath, writeConfiguration } = require('../src/services/configuration');

function parseLegacyCsv(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length || lines[0].trim() !== 'key,value') {
    throw new Error('Legacy config CSV must begin with the key,value header.');
  }

  const config = {};
  for (const [index, line] of lines.slice(1).entries()) {
    const separator = line.indexOf(',');
    if (separator < 1) throw new Error(`Invalid configuration row ${index + 2}.`);
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (Object.prototype.hasOwnProperty.call(config, key)) throw new Error(`Duplicate configuration key: ${key}`);
    config[key] = value;
  }
  return config;
}

function main() {
  if (!process.argv[2]) throw new Error('Usage: node scripts/migrate-config.js /path/to/legacy-config.csv [absolute-destination]');
  const source = path.resolve(process.argv[2]);
  const destination = path.resolve(process.argv[3] || getConfigFilePath());
  if (!fs.existsSync(source)) throw new Error(`Legacy CSV not found: ${source}`);
  if (fs.existsSync(destination) && process.env.FORCE_CONFIG_MIGRATION !== '1') {
    throw new Error(`Destination already exists: ${destination}. Set FORCE_CONFIG_MIGRATION=1 only if you intend to replace it.`);
  }

  const config = parseLegacyCsv(source);
  writeConfiguration(config, destination);
  console.log(`Migrated ${Object.keys(config).length} configuration values to ${destination}.`);
}

try {
  main();
} catch (error) {
  console.error(`Configuration migration failed: ${error.message}`);
  process.exitCode = 1;
}
