const { checkLinkedUsers } = require('../src/services/linkedUserChecker');

checkLinkedUsers()
  .then(({ checked, removed }) => {
    console.log(`Linked-user check finished: checked ${checked}, removed ${removed}.`);
  })
  .catch((err) => {
    console.error('Linked-user check failed:', err);
    process.exitCode = 1;
  });
