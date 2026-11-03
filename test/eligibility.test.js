const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildEligibilityRetryEmbed } = require('../src/utils/eligibility');
const { getUserGroupRoles } = require('../src/services/robloxGroups');

test('eligibility retry embed distinguishes unavailable checks from ineligibility', () => {
  const embed = buildEligibilityRetryEmbed('check-ct', 'ExampleUser', [
    'Account age could not be verified.',
    'Blacklist status could not be verified.',
    'Account age could not be verified.',
  ]).toJSON();

  assert.equal(embed.title, 'Eligibility Check Incomplete');
  assert.match(embed.description, /run `\/check-ct` again shortly/);
  assert.match(embed.description, /not a decision that the user is ineligible/);
  assert.deepEqual(embed.fields[0].value.split('\n'), [
    'Account age could not be verified.',
    'Blacklist status could not be verified.',
  ]);
});

test('incomplete Roblox group responses reject instead of implying no memberships', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ data: null }),
  });
  try {
    await assert.rejects(
      getUserGroupRoles(`incomplete-${Date.now()}`),
      /group roles response was incomplete/,
    );
  } finally {
    global.fetch = originalFetch;
  }
});
