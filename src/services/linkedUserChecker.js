const { getNumericConfigValue } = require('./configuration');
const { getUserGroupRoles } = require('./robloxGroups');
const { getLinkedUsers, updateLinkedUsersAfterGroupCheck } = require('./linkedUsers');

async function checkLinkedUsers() {
  const linkedUsers = getLinkedUsers();
  const mocsGroupId = getNumericConfigValue('mocs_group_id', 10409578);
  const removedUsers = [];
  const activatedUsers = [];

  for (const linkedUser of linkedUsers) {
    if (!linkedUser.robloxId) {
      console.warn(`[linked-users] Skipping ${linkedUser.discordId}: no Roblox ID is stored.`);
      continue;
    }

    try {
      const groupRoles = await getUserGroupRoles(linkedUser.robloxId, { force: true });
      const stillInMocs = groupRoles.some(
        (entry) => String(entry?.group?.id ?? '') === String(mocsGroupId),
      );

      if (linkedUser.linkStatus === 'candidate_pending') {
        if (stillInMocs) activatedUsers.push(linkedUser);
        continue;
      }

      if (!stillInMocs) removedUsers.push(linkedUser);
    } catch (err) {
      console.error(`[linked-users] Could not verify ${linkedUser.discordId}; keeping the entry:`, err.message || err);
    }
  }

  const { activated, removed } = updateLinkedUsersAfterGroupCheck({
    activateUsers: activatedUsers,
    removeUsers: removedUsers,
  });
  console.log(`[linked-users] Daily check complete: checked ${linkedUsers.length}, activated ${activated}, removed ${removed}.`);
  return { checked: linkedUsers.length, activated, removed };
}

module.exports = { checkLinkedUsers };