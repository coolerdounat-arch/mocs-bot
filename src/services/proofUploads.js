const { getConfigValue } = require('./configuration');

function validateProofUrl(proof) {
  try {
    const parsedProof = new URL(proof);
    if (!['http:', 'https:'].includes(parsedProof.protocol)) throw new Error('Unsupported proof protocol.');
  } catch {
    throw new Error('The proof must be a valid link, including `https://` or `http://`.');
  }
}

async function resolveProof({ interaction, commandName, details = {} }) {
  const proofUrl = interaction.options.getString('proof');
  const proofFile = interaction.options.getAttachment('proof_file');

  if (proofUrl && proofFile) {
    throw new Error('Provide either a proof link or a proof file, not both.');
  }
  if (proofUrl) {
    validateProofUrl(proofUrl);
    return proofUrl;
  }
  if (!proofFile) {
    throw new Error('A proof link or proof file is required.');
  }
  const proofUploadChannelId = getConfigValue('log_proof_channel_id');
  if (!proofUploadChannelId) {
    throw new Error('Proof file uploads are not configured. Set log_proof_channel_id in the private MOCS_CONFIG_FILE.');
  }

  const channel = await interaction.client.channels.fetch(proofUploadChannelId);
  if (!channel || !channel.isTextBased()) {
    throw new Error('The configured proof upload channel is not a text channel.');
  }

  const message = await channel.send({
    content: [
      'Proof upload',
      `Timestamp: ${new Date().toISOString()}`,
      `Command: ${commandName}`,
      `Submitted by: ${interaction.user.tag || interaction.user.id}`,
      ...Object.entries(details).map(([name, value]) => `${name}: ${String(value || 'Not provided')}`),
    ].join('\n').slice(0, 1900),
    files: [{ attachment: proofFile.url, name: proofFile.name || 'proof-file' }],
  });
  if (!message.url) {
    throw new Error('The proof file was uploaded but no message URL was returned.');
  }

  return message.url;
}

module.exports = { resolveProof };