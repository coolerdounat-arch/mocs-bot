const { SlashCommandBuilder } = require('discord.js');

const data = new SlashCommandBuilder()
	.setName('greet')
	.setDescription('Greet the bot!');

async function execute(interaction) {
	return interaction.reply(`Greetings, <@${interaction.user.id}>!`);
}

module.exports = { data, execute };
