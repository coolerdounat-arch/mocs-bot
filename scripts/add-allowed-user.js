const userId = String(process.argv[2] || '').trim();
if (!/^\d{17,20}$/.test(userId)) {
  console.error('Usage: node scripts/add-allowed-user.js <discord-user-id>');
  process.exit(1);
}

try {
  const { addPrivilegedUserId } = require('../src/services/linkedUsers');
  const added = addPrivilegedUserId(userId);
  console.log(added ? `Discord user ${userId} is now allowed.` : `Discord user ${userId} is already allowed.`);
} catch (error) {
  console.error(`Could not update privileged users: ${error.message}`);
  process.exitCode = 1;
}