require('dotenv').config({ quiet: true });
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { getDatabasePath } = require('../src/services/linkedUsers');
const { getConfigFilePath } = require('../src/services/configuration');

const DATA_DIRECTORY = path.join(__dirname, '..', 'src', 'data');
const DATA_FILE_PATTERN = /\.(csv|js)$/;
const ARCHIVE_PATTERN = /^mocs-backup-.+\.tar\.zst\.gpg$/;
const LATEST_NAME = 'latest.tar.zst.gpg';

function getSettings() {
  const keep = Number(process.env.MOCS_BACKUP_KEEP || 14);
  return {
    directory: path.resolve(process.env.MOCS_BACKUP_DIR || path.join(path.dirname(getDatabasePath()), 'backups', 'offsite')),
    passphraseFile: process.env.MOCS_BACKUP_PASSPHRASE_FILE || '/etc/mocs-bot/backup-passphrase',
    keep: Number.isInteger(keep) && keep > 0 ? keep : 14,
  };
}

async function stageFiles(staging) {
  const database = new Database(getDatabasePath(), { readonly: true, fileMustExist: true });
  try {
    await database.backup(path.join(staging, 'users.sqlite3'));
  } finally {
    database.close();
  }
  fs.copyFileSync(getConfigFilePath(), path.join(staging, 'config.json'));
  fs.mkdirSync(path.join(staging, 'data'));
  for (const name of fs.readdirSync(DATA_DIRECTORY)) {
    if (DATA_FILE_PATTERN.test(name)) fs.copyFileSync(path.join(DATA_DIRECTORY, name), path.join(staging, 'data', name));
  }
}

function encryptArchive(staging, passphraseFile, destination) {
  const gnupgHome = path.join(staging, '.gnupg');
  const archive = path.join(staging, 'backup.tar.zst');
  fs.mkdirSync(gnupgHome, { mode: 0o700 });
  execFileSync('tar', ['--zstd', '-cf', archive, '-C', staging, '--exclude=./.gnupg', '--exclude=./backup.tar.zst', '.']);
  execFileSync('gpg', [
    '--homedir', gnupgHome, '--batch', '--yes', '--quiet', '--pinentry-mode', 'loopback',
    '--passphrase-file', passphraseFile, '--symmetric', '--cipher-algo', 'AES256',
    '--output', destination, archive,
  ]);
}

function pruneArchives(directory, keep) {
  const archives = fs.readdirSync(directory).filter((name) => ARCHIVE_PATTERN.test(name)).sort();
  for (const name of archives.slice(0, Math.max(0, archives.length - keep))) fs.rmSync(path.join(directory, name));
}

async function main() {
  const { directory, passphraseFile, keep } = getSettings();
  if (!fs.existsSync(passphraseFile)) throw new Error(`Backup passphrase file not found: ${passphraseFile}`);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = path.join(directory, `mocs-backup-${timestamp}.tar.zst.gpg`);
  const temporary = `${destination}.tmp`;
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'mocs-backup-'));
  try {
    await stageFiles(staging);
    encryptArchive(staging, passphraseFile, temporary);
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, destination);
    fs.copyFileSync(destination, path.join(directory, `${LATEST_NAME}.tmp`));
    fs.renameSync(path.join(directory, `${LATEST_NAME}.tmp`), path.join(directory, LATEST_NAME));
    pruneArchives(directory, keep);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.rmSync(temporary, { force: true });
  }
  console.log(`Wrote encrypted backup ${destination}.`);
}

main().catch((error) => {
  console.error(`Off-site backup failed: ${error.message}`);
  process.exitCode = 1;
});
