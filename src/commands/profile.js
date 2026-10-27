const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getRobloxUser, getRobloxUserById, getAvatarHeadshotUrl } = require('../services/roblox');
const { getQuotaLogRows, matchesNameList } = require('../services/googleSheets');
const { getDisplayedGroupRanks } = require('../services/groupRanks');
const { getLinkedUser } = require('../services/linkedUsers');
const { formatTimestamp } = require('../utils/format');
const { showLoading } = require('../services/loadingScreen');

const EMBED_COLOR = 0x2b2d31;

const data = new SlashCommandBuilder()
  .setName('profile')
  .setDescription("Show a member's citizenship profile from the quota logs.")
  .addStringOption((opt) =>
    opt
      .setName('username')
      .setDescription('Roblox username to look up (defaults to your linked Roblox profile)')
      .setRequired(false)
  )
  .setIntegrationTypes(0, 1)
  .setContexts(0, 1, 2);

function formatAttendedLine(row) {
  const timestamp = formatTimestamp(row.timestampSerial);
  return `• **${row.activity}** by **${row.host}** - ${row.description} at **${timestamp} UTC**`;
}

function formatHostedLine(row) {
  const timestamp = formatTimestamp(row.timestampSerial);
  return `• **${row.activity}** - ${row.description} at **${timestamp} UTC**`;
}

function topThreeByRecency(rows) {
  return [...rows].sort((a, b) => b.timestampSerial - a.timestampSerial).slice(0, 3);
}

async function execute(interaction) {
  await showLoading(interaction);

  const providedUsername = interaction.options.getString('username');
  const linkedUser = providedUsername ? null : getLinkedUser(interaction.user.id);
  const fallbackTarget = (interaction.member?.displayName || interaction.user.username).trim();
  const target = (providedUsername || linkedUser?.robloxUsername || fallbackTarget).trim();

  let robloxUser;
  try {
    robloxUser = linkedUser?.robloxId && !providedUsername
      ? await getRobloxUserById(linkedUser.robloxId)
      : await getRobloxUser(target);
  } catch (err) {
    console.error('Roblox lookup failed:', err);
    return interaction.editReply(
      'Something went wrong looking that user up on Roblox. Please try again in a moment.'
    );
  }

  if (!robloxUser) {
    return interaction.editReply(`${target} does not exist`);
  }

  const canonicalUsername = robloxUser.name;

  let rows;
  try {
    rows = await getQuotaLogRows();
  } catch (err) {
    console.error('Google Sheets fetch failed:', err);
    return interaction.editReply(
      'Something went wrong reading the quota log sheet. Please try again in a moment.'
    );
  }

  const attendedRows = topThreeByRecency(
    rows.filter((r) => !r.invalidated && matchesNameList(r.username, canonicalUsername))
  );
  const hostedRows = topThreeByRecency(
    rows.filter((r) => !r.invalidated && matchesNameList(r.host, canonicalUsername))
  );

  const attendedText = attendedRows.length
    ? attendedRows.map(formatAttendedLine).join('\n')
    : 'No events attended yet.';

  const hostedText = hostedRows.length
    ? hostedRows.map(formatHostedLine).join('\n')
    : 'No events hosted yet.';

  let avatarUrl = null;
  try {
    avatarUrl = await getAvatarHeadshotUrl(robloxUser.id);
  } catch (err) {
    console.error('Roblox avatar fetch failed:', err);
  }

  let groupRanks = [];
  let ranksUnavailable = false;
  try {
    groupRanks = await getDisplayedGroupRanks(robloxUser.id);
  } catch (err) {
    ranksUnavailable = true;
    console.error('Group rank lookup failed:', err.message || err);
  }

  const rankFields = ranksUnavailable
    ? [{ name: 'Ranks', value: '⚠️ Group ranks could not be loaded right now.', inline: false }]
    : groupRanks.map((g) => ({
      name: g.label,
      value: g.rankName,
      inline: true,
    }));

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setAuthor({ name: 'Citizenship. Integration. Quality.' })
    .setDescription(`**Information on ${canonicalUsername}**`)
    .addFields(
      ...rankFields,
      { name: '■▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬■', value: '\u200b', inline: false },
      { name: 'Last 3 Events Attended', value: attendedText, inline: false },
      { name: 'Last 3 Events Hosted', value: hostedText, inline: false }
    )
    .setTimestamp();

  if (avatarUrl) embed.setThumbnail(avatarUrl);

  return interaction.editReply({ embeds: [embed] });
}

module.exports = { data, execute, cooldownSeconds: 10, access: 'member' };
