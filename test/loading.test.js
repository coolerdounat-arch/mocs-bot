const assert = require('node:assert/strict');
const { test } = require('node:test');
const { MessageFlags } = require('discord.js');
const { showLoading } = require('../src/services/loadingScreen');

function createInteraction() {
  const calls = { reply: [], editReply: [] };
  return {
    calls,
    client: { user: { username: 'MoCS Bot', displayAvatarURL: () => 'https://cdn.discordapp.com/avatar.png' } },
    async reply(payload) { calls.reply.push(payload); },
    async editReply(payload) { calls.editReply.push(payload); },
  };
}

test('loading screen replies with a footer-branded embed and keeps visibility', async () => {
  const publicInteraction = createInteraction();
  await showLoading(publicInteraction);
  const [publicReply] = publicInteraction.calls.reply;
  const embed = publicReply.embeds[0].toJSON();
  assert.match(embed.description, /Retrieving information\.\.\.$/);
  assert.deepEqual(embed.footer, { text: 'MoCS Bot', icon_url: 'https://cdn.discordapp.com/avatar.png' });
  assert.ok(embed.timestamp);
  assert.equal(publicReply.flags, undefined);

  const privateInteraction = createInteraction();
  await showLoading(privateInteraction, { ephemeral: true, message: 'Checking your rank...' });
  assert.equal(privateInteraction.calls.reply[0].flags, MessageFlags.Ephemeral);
  assert.match(privateInteraction.calls.reply[0].embeds[0].toJSON().description, /Checking your rank\.\.\.$/);
});

test('final replies replace the loading embed unless they bring their own embeds', async () => {
  const interaction = createInteraction();
  await showLoading(interaction);
  await interaction.editReply('User does not exist');
  await interaction.editReply({ content: 'Logged.' });
  await interaction.editReply({ embeds: ['result'], files: ['avatar'] });
  await interaction.setLoadingMessage('Checking blacklist...');
  const [text, object, result, progress] = interaction.calls.editReply;
  assert.deepEqual(text, { content: 'User does not exist', embeds: [] });
  assert.deepEqual(object, { content: 'Logged.', embeds: [] });
  assert.deepEqual(result, { embeds: ['result'], files: ['avatar'] });
  assert.match(progress.embeds[0].toJSON().description, /Checking blacklist\.\.\.$/);
});
