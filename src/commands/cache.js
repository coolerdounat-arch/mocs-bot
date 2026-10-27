const { EmbedBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { isPrivilegedDiscordUser } = require('../services/linkedUsers');
const { getAllCacheStats, getCacheNames, clearCaches } = require('../utils/cache');

const data = new SlashCommandBuilder()
  .setName('cache')
  .setDescription('Inspect or clear the bot lookup caches. Requires permission.')
  .setIntegrationTypes(0, 1)
  .setContexts(0, 1, 2)
  .addSubcommand((subcommand) => subcommand
    .setName('stats')
    .setDescription('Show entries, hit rate, and load counts for every cache.'))
  .addSubcommand((subcommand) => subcommand
    .setName('clear')
    .setDescription('Clear one cache or all caches so the next lookup fetches fresh data.')
    .addStringOption((option) => option
      .setName('name')
      .setDescription('Cache to clear; leave empty to clear all caches.')
      .setAutocomplete(true)));

function formatTtl(ms) {
  if (ms >= 3_600_000) return `${Math.round(ms / 3_600_000)}h`;
  if (ms >= 60_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 1000)}s`;
}

function formatHitRate(hitRate) {
  return hitRate === null ? 'n/a' : `${(hitRate * 100).toFixed(1)}%`;
}

function buildStatsEmbed() {
  const stats = getAllCacheStats();
  const totals = stats.reduce((sum, cache) => ({
    hits: sum.hits + cache.hits,
    misses: sum.misses + cache.misses,
    size: sum.size + cache.size,
  }), { hits: 0, misses: 0, size: 0 });
  const lookups = totals.hits + totals.misses;

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Cache Statistics')
    .setDescription(`${stats.length} caches · ${totals.size} entries · overall hit rate ${formatHitRate(lookups ? totals.hits / lookups : null)}`)
    .addFields(stats.slice(0, 25).map((cache) => ({
      name: cache.name,
      value: [
        `Entries: ${cache.size}/${cache.maxEntries} · TTL ${formatTtl(cache.ttlMs)}`,
        `Hit rate: ${formatHitRate(cache.hitRate)} (${cache.hits} hits, ${cache.misses} misses)`,
        `Loads: ${cache.loads} · Errors: ${cache.errors} · Evictions: ${cache.evictions}${cache.inflight ? ` · In flight: ${cache.inflight}` : ''}`,
      ].join('\n'),
      inline: false,
    })))
    .setTimestamp();
}

async function execute(interaction) {
  if (!isPrivilegedDiscordUser(interaction.user.id)) {
    return interaction.reply({ content: 'You are not authorized to use this command.', flags: MessageFlags.Ephemeral });
  }

  if (interaction.options.getSubcommand() === 'stats') {
    return interaction.reply({ embeds: [buildStatsEmbed()], flags: MessageFlags.Ephemeral });
  }

  const name = interaction.options.getString('name');
  if (name && !getCacheNames().includes(name)) {
    return interaction.reply({ content: `Unknown cache \`${name}\`. Use /cache stats to see the cache names.`, flags: MessageFlags.Ephemeral });
  }
  const cleared = clearCaches(name || null);
  const total = Object.values(cleared).reduce((sum, count) => sum + count, 0);
  console.log(`[cache] ${interaction.user.id} cleared ${name || 'all caches'} (${total} entries).`);
  return interaction.reply({
    content: name
      ? `Cleared \`${name}\` (${total} entries).`
      : `Cleared all ${Object.keys(cleared).length} caches (${total} entries).`,
    flags: MessageFlags.Ephemeral,
  });
}

async function autocomplete(interaction) {
  if (!isPrivilegedDiscordUser(interaction.user.id)) return interaction.respond([]);
  const focused = String(interaction.options.getFocused() || '').toLowerCase();
  return interaction.respond(getCacheNames()
    .filter((name) => name.includes(focused))
    .slice(0, 25)
    .map((name) => ({ name, value: name })));
}

module.exports = { data, execute, autocomplete };
