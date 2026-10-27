const { SlashCommandBuilder } = require('discord.js');
const { buildActivityRow, getLinkedMocsContext, appendAutoLogRows } = require('../services/activityLogger');
const { getLogTypeChoices, getMinimumRank } = require('../services/logTypes');
const { resolveProof } = require('../services/proofUploads');
const { showLoading } = require('../services/loadingScreen');

const data = new SlashCommandBuilder()
  .setName('log-others')
  .setDescription('Log a CT Ranking or Extra QP activity to the AutoLogs sheet.')
  .setIntegrationTypes(0)
  .setContexts(0)
  .addStringOption((option) => option
    .setName('log_type')
    .setDescription('Type of other activity to log')
    .addChoices(...getLogTypeChoices('log-others'))
    .setRequired(true))
  .addStringOption((option) => option
    .setName('description')
    .setDescription('Description of the activity')
    .setRequired(true))
  .addStringOption((option) => option
    .setName('number')
    .setDescription('Number for the activity')
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
  const minimumRank = getMinimumRank('log-others', activity);

  let context;
  try {
    context = await getLinkedMocsContext(interaction.user.id, minimumRank);
  } catch (err) {
    console.error('[log-others] Failed to resolve linked MoCS user:', err);
    return interaction.editReply({ content: 'I could not verify your MoCS rank right now. Please try again later.' });
  }
  if (context.error) return interaction.editReply({ content: context.error.replace('this command', '/log-others') });

  const description = interaction.options.getString('description');
  const number = interaction.options.getString('number');
  let proof;
  try {
    proof = await resolveProof({
      interaction,
      commandName: '/log-others',
      details: {
        'Roblox user': context.robloxUsername,
        Rank: context.rank,
        'Log type': activity,
        Description: description,
        Number: number,
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
    duration: number,
    proof,
  });

  try {
    await appendAutoLogRows({ rows: [row] });
    return interaction.editReply({ content: `Logged a ${row[3]} for ${context.robloxUsername} in the AutoLogs sheet.` });
  } catch (err) {
    console.error('[log-others] Failed to append activity row:', err);
    return interaction.editReply({ content: `The activity log could not be written: ${err.message}` });
  }
}

module.exports = { data, execute, cooldownSeconds: 5 };
