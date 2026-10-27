const { EmbedBuilder, MessageFlags, MessagePayload } = require('discord.js');

const LOADING_EMOJI_NAME = 'loading';
const LOADING_COLOR = 0x1abc9c;
const DEFAULT_LOADING_MESSAGE = 'Retrieving information...';
const FALLBACK_EMOJI = '⏳';
let loadingEmoji = process.env.LOADING_EMOJI || null;

async function resolveLoadingEmoji(client) {
  if (process.env.LOADING_EMOJI) return loadingEmoji;
  try {
    const emojis = await client.application.emojis.fetch();
    const emoji = emojis.find((entry) => entry.name === LOADING_EMOJI_NAME);
    if (emoji) {
      loadingEmoji = emoji.toString();
    } else {
      console.warn(`[loading] No application emoji named "${LOADING_EMOJI_NAME}"; run npm run upload:loading-emoji. Using ${FALLBACK_EMOJI} until then.`);
    }
  } catch (error) {
    console.warn('[loading] Could not load application emojis:', error.message || error);
  }
  return loadingEmoji;
}

function buildLoadingEmbed(client, message = DEFAULT_LOADING_MESSAGE) {
  const embed = new EmbedBuilder()
    .setColor(LOADING_COLOR)
    .setDescription(`${loadingEmoji || FALLBACK_EMOJI} ${message}`)
    .setTimestamp();
  if (client.user) {
    embed.setFooter({ text: client.user.username, iconURL: client.user.displayAvatarURL() });
  }
  return embed;
}

function withoutLoadingEmbed(payload) {
  if (typeof payload === 'string') return { content: payload, embeds: [] };
  if (payload instanceof MessagePayload || 'embeds' in payload) return payload;
  return { ...payload, embeds: [] };
}

async function showLoading(interaction, { message = DEFAULT_LOADING_MESSAGE, ephemeral = false } = {}) {
  const editReply = interaction.editReply.bind(interaction);
  interaction.editReply = (payload) => editReply(withoutLoadingEmbed(payload));
  interaction.setLoadingMessage = (nextMessage) => editReply({ embeds: [buildLoadingEmbed(interaction.client, nextMessage)] });
  await interaction.reply({
    embeds: [buildLoadingEmbed(interaction.client, message)],
    ...(ephemeral ? { flags: MessageFlags.Ephemeral } : {}),
  });
}

module.exports = {
  LOADING_EMOJI_NAME,
  buildLoadingEmbed,
  resolveLoadingEmoji,
  showLoading,
  withoutLoadingEmbed,
};
