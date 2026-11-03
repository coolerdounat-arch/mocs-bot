const { EmbedBuilder } = require('discord.js');

function buildEligibilityRetryEmbed(commandName, username, unavailableChecks) {
  const checks = [...new Set(unavailableChecks)].filter(Boolean);
  const description = [
    `The bot couldn't verify **${username}**'s eligibility because one or more required checks are unavailable.`,
    `Please run \`/${commandName}\` again shortly. This is not a decision that the user is ineligible.`,
  ].join('\n\n');

  return new EmbedBuilder()
    .setColor(0xffcc00)
    .setTitle('Eligibility Check Incomplete')
    .setDescription(description)
    .addFields({
      name: 'Checks that could not be verified',
      value: checks.length ? checks.join('\n').slice(0, 1024) : 'Eligibility data was unavailable.',
    })
    .setFooter({ text: 'Citizenship. Integration. Quality.' })
    .setTimestamp();
}

module.exports = { buildEligibilityRetryEmbed };
