const { SlashCommandBuilder } = require('discord.js');
const { buildActivityRow, getLinkedMocsContext, appendAutoLogRows } = require('../services/activityLogger');
const { getLogTypeChoices, getMinimumRank } = require('../services/logTypes');
const { resolveProof } = require('../services/proofUploads');
const { showLoading } = require('../services/loadingScreen');

const STANDARD_EVENT_MINIMUM_RANK = 110;

const data = new SlashCommandBuilder()
  .setName('log-event')
  .setDescription('Log an event activity to the AutoLogs sheet.')
  .setIntegrationTypes(0)
  .setContexts(0)
  .addStringOption((option) => option
    .setName('log_type')
    .setDescription('Type of event to log')
    .addChoices(...getLogTypeChoices('log-event'))
    .setRequired(true))
  .addStringOption((option) => option
    .setName('description')
    .setDescription('Description of the event')
    .setRequired(true))
  .addStringOption((option) => option
    .setName('attendee')
    .setDescription('Username of the attendee')
    .setRequired(true))
  .addStringOption((option) => option
    .setName('proof')
    .setDescription('Proof link')
    .setRequired(false))
  .addAttachmentOption((option) => option
    .setName('proof_file')
    .setDescription('Proof file upload')
    .setRequired(false));

async function execute(interaction) {
  await showLoading(interaction, { ephemeral: true });
  const activity = interaction.options.getString('log_type');
  const minimumRank = getMinimumRank('log-event', activity, STANDARD_EVENT_MINIMUM_RANK);

  let context;
  try {
    context = await getLinkedMocsContext(interaction.user.id, minimumRank);
  } catch (err) {
    console.error('[log-event] Failed to resolve linked MoCS user:', err);
    return interaction.editReply({ content: 'I could not verify your MoCS rank right now. Please try again later.' });
  }
  if (context.error) return interaction.editReply({ content: context.error.replace('this command', '/log-event') });

  const description = interaction.options.getString('description');
  const attendee = interaction.options.getString('attendee');
  let proof;
  try {
    proof = await resolveProof({
      interaction,
      commandName: '/log-event',
      details: {
        'Roblox user': context.robloxUsername,
        Rank: context.rank,
        'Log type': activity,
        Description: description,
        Attendee: attendee,
      },
    });
  } catch (err) {
    return interaction.editReply({ content: err.message });
  }

  const row = buildActivityRow({
    robloxUsername: context.robloxUsername,
    rank: context.rank,
    activity,
    description,
    attendee,
    proof,
  });

  try {
    await appendAutoLogRows({ rows: [row] });
    return interaction.editReply({ content: `Logged a ${row[3]} for ${context.robloxUsername} in the AutoLogs sheet.` });
  } catch (err) {
    console.error('[log-event] Failed to append event row:', err);
    return interaction.editReply({ content: `The event log could not be written: ${err.message}` });
  }
}

module.exports = { data, execute, cooldownSeconds: 5 };
