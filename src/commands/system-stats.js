const os = require('os');
const { EmbedBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { version: botVersion } = require('../../package.json');
const { getAllCacheStats } = require('../utils/cache');

const data = new SlashCommandBuilder()
  .setName('system-stats')
  .setDescription('Show the bot host and process system statistics')
  .setIntegrationTypes(0, 1)
  .setContexts(0, 1, 2);

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDuration(seconds) {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const parts = [];

  if (days) parts.push(`${days}d`);
  if (hours || days) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

async function execute(interaction) {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const cpuModel = os.cpus()[0]?.model ?? 'Unknown CPU';
  const loadAverage = process.platform === 'win32'
    ? 'Unavailable on Windows'
    : os.loadavg().map((load) => load.toFixed(2)).join(', ');
  const processMemory = process.memoryUsage();
  const cacheStats = getAllCacheStats();
  const cacheHits = cacheStats.reduce((sum, cache) => sum + cache.hits, 0);
  const cacheLookups = cacheHits + cacheStats.reduce((sum, cache) => sum + cache.misses, 0);
  const cacheEntries = cacheStats.reduce((sum, cache) => sum + cache.size, 0);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('System Statistics')
    .addFields(
      { name: 'Host uptime', value: formatDuration(os.uptime()), inline: true },
      { name: 'Bot uptime', value: formatDuration(process.uptime()), inline: true },
      { name: 'Discord latency', value: `${interaction.client.ws.ping} ms`, inline: true },
      { name: 'Memory', value: `${formatBytes(usedMemory)} / ${formatBytes(totalMemory)} (${((usedMemory / totalMemory) * 100).toFixed(1)}%)`, inline: true },
      { name: 'Bot memory', value: `RSS: ${formatBytes(processMemory.rss)}\nHeap: ${formatBytes(processMemory.heapUsed)} / ${formatBytes(processMemory.heapTotal)}`, inline: true },
      { name: 'Load average', value: loadAverage, inline: true },
      { name: 'Cache', value: `${cacheEntries} entries in ${cacheStats.length} caches\nHit rate: ${cacheLookups ? `${((cacheHits / cacheLookups) * 100).toFixed(1)}%` : 'n/a'}`, inline: true },
      { name: 'CPU', value: `${cpuModel}\n${os.cpus().length} logical cores`, inline: false },
      { name: 'Runtime', value: `${os.type()} ${os.release()}\nNode.js ${process.version}\nBot version ${botVersion}`, inline: false },
    )
    .setTimestamp();

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

module.exports = { data, execute, cooldownSeconds: 5, access: 'privileged' };
