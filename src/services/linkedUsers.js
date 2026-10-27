const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DEVELOPMENT_DATABASE_PATH = path.join(__dirname, '..', 'data', 'users.sqlite3');
const PROTECTED_PRIVILEGED_USER_ID = '810949647316287563';
let database = null;
let databasePath = null;

function getDatabasePath() {
  const configuredPath = process.env.MOCS_SQLITE_FILE
    || (process.env.NODE_ENV === 'production' ? '/var/lib/mocs-bot/users.sqlite3' : DEVELOPMENT_DATABASE_PATH);
  if (!path.isAbsolute(configuredPath)) throw new Error('MOCS_SQLITE_FILE must be an absolute path.');
  return path.resolve(configuredPath);
}

function secureDatabaseFiles(filePath) {
  for (const file of [filePath, `${filePath}-wal`, `${filePath}-shm`]) {
    if (fs.existsSync(file)) fs.chmodSync(file, 0o600);
  }
}

function getDatabase() {
  const filePath = getDatabasePath();
  if (database && databasePath === filePath) return database;
  if (database) database.close();

  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o750 });
  database = new Database(filePath);
  databasePath = filePath;
  database.pragma('journal_mode = WAL');
  database.pragma('synchronous = FULL');
  database.pragma('busy_timeout = 5000');
  database.exec(`
    CREATE TABLE IF NOT EXISTS linked_users (
      discord_id TEXT PRIMARY KEY NOT NULL,
      roblox_id TEXT NOT NULL UNIQUE,
      roblox_username TEXT NOT NULL,
      link_status TEXT NOT NULL DEFAULT 'active' CHECK (link_status IN ('active', 'candidate_pending')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS privileged_users (
      discord_id TEXT PRIMARY KEY NOT NULL
    );
    CREATE TABLE IF NOT EXISTS database_migrations (
      migration_key TEXT PRIMARY KEY NOT NULL,
      completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  database.prepare('INSERT OR IGNORE INTO privileged_users (discord_id) VALUES (?)').run(PROTECTED_PRIVILEGED_USER_ID);
  secureDatabaseFiles(filePath);
  return database;
}

function toLinkedUser(row) {
  if (!row) return null;
  return {
    discordId: String(row.discord_id),
    robloxId: String(row.roblox_id),
    robloxUsername: String(row.roblox_username),
    linkStatus: String(row.link_status),
  };
}

function getLinkedUser(discordId) {
  const row = getDatabase().prepare('SELECT discord_id, roblox_id, roblox_username, link_status FROM linked_users WHERE discord_id = ?').get(String(discordId));
  return toLinkedUser(row);
}

function getLinkedUsers() {
  return getDatabase()
    .prepare('SELECT discord_id, roblox_id, roblox_username, link_status FROM linked_users ORDER BY rowid')
    .all()
    .map(toLinkedUser);
}

function getLinkedUserCount() {
  return getDatabase().prepare('SELECT COUNT(*) AS count FROM linked_users').get().count;
}

function getPrivilegedUserIds() {
  return getDatabase()
    .prepare('SELECT discord_id FROM privileged_users ORDER BY discord_id')
    .all()
    .map((row) => String(row.discord_id));
}

function isPrivilegedDiscordUser(discordId) {
  return Boolean(getDatabase()
    .prepare('SELECT 1 FROM privileged_users WHERE discord_id = ?')
    .get(String(discordId)));
}

function addPrivilegedUserId(userId) {
  const normalizedId = String(userId || '').trim();
  if (!/^\d{17,20}$/.test(normalizedId)) {
    throw new Error('Discord IDs must be numeric and 17-20 digits long.');
  }
  return getDatabase()
    .prepare('INSERT OR IGNORE INTO privileged_users (discord_id) VALUES (?)')
    .run(normalizedId).changes > 0;
}

function isProtectedPrivilegedUserId(userId) {
  return String(userId || '').trim() === PROTECTED_PRIVILEGED_USER_ID;
}

function removePrivilegedUserId(userId) {
  const normalizedId = String(userId || '').trim();
  if (isProtectedPrivilegedUserId(normalizedId)) return false;
  return getDatabase()
    .prepare('DELETE FROM privileged_users WHERE discord_id = ?')
    .run(normalizedId).changes > 0;
}

function assertRobloxLinkAvailable(discordId, robloxId, rows) {
  const existing = rows
    ? rows.find((row) => row.robloxId === String(robloxId) && row.discordId !== String(discordId))
    : getDatabase().prepare('SELECT 1 FROM linked_users WHERE roblox_id = ? AND discord_id != ?').get(String(robloxId), String(discordId));
  if (existing) throw new Error('That Roblox account is already linked to another Discord user.');
}

function saveLinkedUser({ discordId, robloxId, robloxUsername, linkStatus = 'active' }) {
  const normalized = {
    discordId: String(discordId).trim(),
    robloxId: String(robloxId).trim(),
    robloxUsername: String(robloxUsername).trim(),
    linkStatus: String(linkStatus || 'active'),
  };
  if (!normalized.discordId || !normalized.robloxId || !normalized.robloxUsername) {
    throw new Error('Discord ID, Roblox ID, and Roblox username are required.');
  }
  if (!['active', 'candidate_pending'].includes(normalized.linkStatus)) {
    throw new Error('Linked account status must be active or candidate_pending.');
  }

  const database = getDatabase();
  assertRobloxLinkAvailable(normalized.discordId, normalized.robloxId);
  try {
    database.prepare(`
      INSERT INTO linked_users (discord_id, roblox_id, roblox_username, link_status)
      VALUES (@discordId, @robloxId, @robloxUsername, @linkStatus)
      ON CONFLICT(discord_id) DO UPDATE SET
        roblox_id = excluded.roblox_id,
        roblox_username = excluded.roblox_username,
        link_status = excluded.link_status,
        updated_at = CURRENT_TIMESTAMP
    `).run(normalized);
  } catch (error) {
    if (String(error.message).includes('linked_users.roblox_id')) {
      throw new Error('That Roblox account is already linked to another Discord user.');
    }
    throw error;
  }
  secureDatabaseFiles(databasePath);
  return getLinkedUser(normalized.discordId);
}

function removeLinkedUsers(discordIds) {
  const ids = [...new Set((discordIds || []).map((id) => String(id)))];
  if (!ids.length) return 0;
  const database = getDatabase();
  const remove = database.prepare('DELETE FROM linked_users WHERE discord_id = ?');
  const removeAll = database.transaction((values) => values.reduce((count, id) => count + remove.run(id).changes, 0));
  const removed = removeAll(ids);
  secureDatabaseFiles(databasePath);
  return removed;
}

function updateLinkedUsersAfterGroupCheck({ activateUsers = [], removeUsers = [] } = {}) {
  if (!activateUsers.length && !removeUsers.length) return { activated: 0, removed: 0 };
  const database = getDatabase();
  const activate = database.prepare(`
    UPDATE linked_users SET link_status = 'active', updated_at = CURRENT_TIMESTAMP
    WHERE discord_id = ? AND roblox_id = ? AND link_status = 'candidate_pending'
  `);
  const remove = database.prepare(`
    DELETE FROM linked_users WHERE discord_id = ? AND roblox_id = ? AND link_status != 'candidate_pending'
  `);
  const apply = database.transaction(() => {
    let activated = 0;
    let removed = 0;
    for (const user of activateUsers) activated += activate.run(String(user.discordId), String(user.robloxId)).changes;
    for (const user of removeUsers) removed += remove.run(String(user.discordId), String(user.robloxId)).changes;
    return { activated, removed };
  });
  const result = apply();
  secureDatabaseFiles(databasePath);
  return result;
}

function removeLinkedUsersIfUnchanged(snapshotUsers) {
  return updateLinkedUsersAfterGroupCheck({ removeUsers: snapshotUsers }).removed;
}

function importLinkedUsers(rows) {
  if (!Array.isArray(rows)) throw new TypeError('Linked-user import must be an array.');
  const database = getDatabase();
  if (getLinkedUserCount() !== 0) throw new Error('SQLite linked-user database is not empty; refusing to import over existing records.');
  const insert = database.prepare(`
    INSERT INTO linked_users (discord_id, roblox_id, roblox_username, link_status)
    VALUES (@discordId, @robloxId, @robloxUsername, @linkStatus)
  `);
  const importAll = database.transaction((users) => {
    for (const user of users) {
      const linkStatus = String(user.linkStatus || 'active');
      if (!['active', 'candidate_pending'].includes(linkStatus)) throw new Error('Linked account status must be active or candidate_pending.');
      insert.run({
        discordId: String(user.discordId).trim(),
        robloxId: String(user.robloxId).trim(),
        robloxUsername: String(user.robloxUsername).trim(),
        linkStatus,
      });
    }
  });
  importAll(rows);
  secureDatabaseFiles(databasePath);
  return getLinkedUserCount();
}

function closeLinkedUsersDatabase() {
  if (database) database.close();
  database = null;
  databasePath = null;
}

module.exports = {
  isProtectedPrivilegedUserId,
  getDatabase,
  getDatabasePath,
  getLinkedUser,
  getLinkedUsers,
  getLinkedUserCount,
  getPrivilegedUserIds,
  isPrivilegedDiscordUser,
  addPrivilegedUserId,
  removePrivilegedUserId,
  saveLinkedUser,
  removeLinkedUsers,
  removeLinkedUsersIfUnchanged,
  updateLinkedUsersAfterGroupCheck,
  assertRobloxLinkAvailable,
  importLinkedUsers,
  closeLinkedUsersDatabase,
};
