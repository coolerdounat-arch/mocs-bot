const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CONFIG_KEYS = new Set([
  'mocs_group_id',
  'irf_group_id',
  'government_group_id',
  'candidate_admin_channel_id',
  'candidate_welcome_channel_id',
  'candidate_denied_log_channel_id',
  'candidate_ministry_role_id',
  'candidate_novice_role_id',
  'candidate_notification_role_id',
  'candidate_novice_program_url',
  'candidate_database_url',
  'ct_ranking_channel_id',
  'ct_ranking_role_id',
  'ct_ineligible_notification_channel_id',
  'ct_ineligible_notification_role_id',
  'log_proof_channel_id',
  'google_sheet_id',
  'google_sheet_tab',
  'google_sheet_start_row',
  'google_autolog_sheet_id',
  'google_autolog_sheet_tab',
  'google_autolog_sheet_range',
  'google_blacklist_sheet_id',
  'google_blacklist_sheet_tab',
  'google_blacklist_start_row',
  'google_groups_sheet_id',
  'google_groups_sheet_tab',
  'qp_sheet_id',
  'fsa_sheet_id',
]);

function getConfigFilePath() {
  const configuredPath = process.env.MOCS_CONFIG_FILE || '/etc/mocs-bot/config.json';
  if (!path.isAbsolute(configuredPath)) throw new Error('MOCS_CONFIG_FILE must be an absolute path.');
  return configuredPath;
}

function validateConfiguration(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Private configuration must be a JSON object.');
  }
  for (const [key, value] of Object.entries(config)) {
    if (!CONFIG_KEYS.has(key)) throw new Error(`Unsupported configuration key: ${key}`);
    if (typeof value !== 'string' || /[\r\n]/.test(value)) {
      throw new Error(`Configuration value for ${key} must be a single-line string.`);
    }
  }
  return config;
}

let configCache = { key: null, config: null };

function getConfiguration() {
  const filePath = getConfigFilePath();
  try {
    const stats = fs.statSync(filePath);
    const cacheKey = `${filePath}:${stats.ino}:${stats.size}:${stats.mtimeMs}`;
    if (configCache.key === cacheKey) return { ...configCache.config };
    const config = validateConfiguration(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    configCache = { key: cacheKey, config };
    return { ...config };
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Private configuration file not found: ${filePath}. Set MOCS_CONFIG_FILE or run scripts/migrate-config.js.`);
    }
    if (error instanceof SyntaxError) throw new Error(`Private configuration file is not valid JSON: ${filePath}`);
    throw error;
  }
}

function getConfigValue(key, fallback = '') {
  if (!CONFIG_KEYS.has(key)) throw new Error(`Unsupported configuration key: ${key}`);
  const config = getConfiguration();
  return Object.prototype.hasOwnProperty.call(config, key) ? config[key] : fallback;
}

function getNumericConfigValue(key, fallback) {
  const value = Number(getConfigValue(key, fallback));
  return Number.isFinite(value) ? value : fallback;
}

function getConfigurationContents() {
  return `${JSON.stringify(getConfiguration(), null, 2)}\n`;
}

function writeConfiguration(config, filePath = getConfigFilePath()) {
  if (!path.isAbsolute(filePath)) throw new Error('Configuration path must be absolute.');
  validateConfiguration(config);
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    fs.renameSync(temporaryPath, filePath);
    fs.chmodSync(filePath, 0o600);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function setConfigValue(key, value) {
  if (!CONFIG_KEYS.has(key)) throw new Error(`Unsupported configuration key: ${key}`);
  const normalizedValue = String(value ?? '').trim();
  if (!normalizedValue || /[\r\n]/.test(normalizedValue)) throw new Error('Enter a non-empty, single-line configuration value.');
  const config = { ...getConfiguration(), [key]: normalizedValue };
  writeConfiguration(config);
  return config;
}

module.exports = {
  CONFIG_KEYS,
  getConfigFilePath,
  getConfiguration,
  getConfigurationContents,
  getConfigValue,
  getNumericConfigValue,
  setConfigValue,
  validateConfiguration,
  writeConfiguration,
};
