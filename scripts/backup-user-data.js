require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { getDatabasePath } = require('../src/services/linkedUsers');

async function main() {
  const source = getDatabasePath();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = path.resolve(process.argv[2] || path.join(path.dirname(source), 'backups', `users-${timestamp}.sqlite3`));
  if (destination === source) throw new Error('Backup destination must differ from the live database path.');
  if (fs.existsSync(destination)) throw new Error(`Backup already exists: ${destination}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });

  const database = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await database.backup(destination);
  } finally {
    database.close();
  }
  fs.chmodSync(destination, 0o600);
  console.log(`Backed up SQLite user data to ${destination}.`);
}

main().catch((error) => {
  console.error(`User-data backup failed: ${error.message}`);
  process.exitCode = 1;
});
