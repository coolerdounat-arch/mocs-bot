require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');
const { LOADING_EMOJI_NAME } = require('../src/services/loadingScreen');

const IMAGE_PATH = path.join(__dirname, '..', 'src', 'data', 'loading.gif');

(async () => {
  const applicationId = process.env.DISCORD_CLIENT_ID;
  if (!process.env.DISCORD_TOKEN || !applicationId) throw new Error('DISCORD_TOKEN and DISCORD_CLIENT_ID must be set.');

  const rest = new REST({ timeout: 15_000 }).setToken(process.env.DISCORD_TOKEN);
  const { items = [] } = await rest.get(Routes.applicationEmojis(applicationId));
  const existing = items.find((emoji) => emoji.name === LOADING_EMOJI_NAME);
  if (existing) {
    console.log(`Application emoji already exists: <a:${existing.name}:${existing.id}>`);
    return;
  }

  const image = `data:image/gif;base64,${fs.readFileSync(IMAGE_PATH).toString('base64')}`;
  const emoji = await rest.post(Routes.applicationEmojis(applicationId), { body: { name: LOADING_EMOJI_NAME, image } });
  console.log(`Uploaded application emoji <a:${emoji.name}:${emoji.id}>. Restart the bot to use it.`);
})().catch((error) => {
  console.error('Failed to upload the loading emoji:', error.message || error);
  process.exit(1);
});
