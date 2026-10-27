const { createCache } = require('../utils/cache');
const { isPrivilegedDiscordUser } = require('./linkedUsers');

const cooldowns = createCache('command-cooldowns', { ttlMs: 60_000, maxEntries: 10_000, clone: false });

function checkCommandCooldown(command, userId) {
  const seconds = Number(command.cooldownSeconds) || 0;
  if (seconds <= 0 || isPrivilegedDiscordUser(userId)) return null;

  const key = `${command.data.name}:${userId}`;
  const expiresAt = cooldowns.get(key);
  if (expiresAt && expiresAt > Date.now()) return expiresAt;

  cooldowns.set(key, Date.now() + seconds * 1000, seconds * 1000);
  return null;
}

function resetCommandCooldowns() {
  return cooldowns.clear();
}

module.exports = { checkCommandCooldown, resetCommandCooldowns };
