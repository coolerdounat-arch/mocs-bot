const { SlashCommandBuilder } = require('discord.js');
const { buildActivityRow, getLinkedMocsContext, appendAutoLogRows } = require('../services/activityLogger');
const { getLogTypeChoices } = require('../services/logTypes');
const { resolveProof } = require('../services/proofUploads');
const { showLoading } = require('../services/loadingScreen');

const data = new SlashCommandBuilder()
  .setName('log-patrol')
  .setDescription('Log a Solo Patrol to the AutoLogs sheet.')
  .setIntegrationTypes(0)
  .setContexts(0)
  .addStringOption((option) => option
    .setName('log_type')
    .setDescription('Type of patrol log')
    .addChoices(...getLogTypeChoices('log-patrol'))
    .setRequired(true))
  .addStringOption((option) => option
    .setName('duration')
    .setDescription('Duration of the patrol')
    .setRequired(true))
  .addStringOption((option) => option
    .setName('description')
    .setDescription('Description of the patrol')
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
  let context;
  try {
    context = await getLinkedMocsContext(interaction.user.id);
  } catch (err) {
    console.error('[log-patrol] Failed to resolve linked MoCS user:', err);
    return interaction.editReply({ content: 'I could not verify your MoCS rank right now. Please try again later.' });
  }
  if (context.error) return interaction.editReply({ content: context.error.replace('this command', '/log-patrol') });

  const logType = interaction.options.getString('log_type');
  const description = interaction.options.getString('description');
  const duration = interaction.options.getString('duration');
  let proof;
  try {
    proof = await resolveProof({
      interaction,
      commandName: '/log-patrol',
      details: {
        'Roblox user': context.robloxUsername,
        Rank: context.rank,
        'Log type': logType,
        Description: description,
        Duration: duration,
      },
    });
  } catch (err) {
    return interaction.editReply({ content: err.message });
  }

  const row = buildActivityRow({
    robloxUsername: context.robloxUsername,
    rank: context.rank,
    activity: logType,
    description,
    duration,
    proof,
  });

  try {
    await appendAutoLogRows({ rows: [row] });
    return interaction.editReply({ content: `Logged a ${logType} for ${context.robloxUsername} in the AutoLogs sheet.` });
  } catch (err) {
    console.error('[log-patrol] Failed to append AutoLogs row:', err);
    return interaction.editReply({ content: `The ${logType} log could not be written: ${err.message}` });
  }
}

module.exports = { data, execute, cooldownSeconds: 5 };
