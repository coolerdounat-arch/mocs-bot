const registry = new Map();

function cloneValue(value) {
  return value === null || typeof value !== 'object' ? value : structuredClone(value);
}

function createCache(name, { ttlMs = 60_000, maxEntries = 500, clone = true, cacheIf = () => true } = {}) {
  const entries = new Map();
  const inflight = new Map();
  const stats = { hits: 0, misses: 0, loads: 0, errors: 0, evictions: 0 };
  let generation = 0;
  const output = (value) => (clone ? cloneValue(value) : value);

  function readEntry(key) {
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      entries.delete(key);
      return undefined;
    }
    entries.delete(key);
    entries.set(key, entry);
    return entry;
  }

  function set(key, value, entryTtlMs = ttlMs) {
    entries.delete(key);
    entries.set(key, { value, expiresAt: Date.now() + entryTtlMs });
    while (entries.size > maxEntries) {
      entries.delete(entries.keys().next().value);
      stats.evictions += 1;
    }
    return value;
  }

  function get(key) {
    const entry = readEntry(key);
    if (!entry) {
      stats.misses += 1;
      return undefined;
    }
    stats.hits += 1;
    return output(entry.value);
  }

  function has(key) {
    return readEntry(key) !== undefined;
  }

  function remove(key) {
    inflight.delete(key);
    return entries.delete(key);
  }

  function clear() {
    const cleared = entries.size;
    entries.clear();
    inflight.clear();
    generation += 1;
    return cleared;
  }

  async function wrap(key, loader, { force = false } = {}) {
    if (force) remove(key);
    const entry = readEntry(key);
    if (entry) {
      stats.hits += 1;
      return output(entry.value);
    }
    stats.misses += 1;

    let pending = inflight.get(key);
    if (!pending) {
      const loadGeneration = generation;
      stats.loads += 1;
      pending = (async () => {
        try {
          const value = await Promise.resolve().then(loader);
          if (loadGeneration === generation && cacheIf(value)) set(key, value);
          return value;
        } catch (error) {
          stats.errors += 1;
          throw error;
        } finally {
          if (inflight.get(key) === pending) inflight.delete(key);
        }
      })();
      inflight.set(key, pending);
    }
    return output(await pending);
  }

  function prune() {
    const now = Date.now();
    let pruned = 0;
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= now) {
        entries.delete(key);
        pruned += 1;
      }
    }
    return pruned;
  }

  function getStats() {
    prune();
    const lookups = stats.hits + stats.misses;
    return {
      name,
      ttlMs,
      maxEntries,
      size: entries.size,
      inflight: inflight.size,
      ...stats,
      hitRate: lookups ? stats.hits / lookups : null,
    };
  }

  const cache = { name, get, set, has, delete: remove, clear, wrap, prune, getStats };
  registry.set(name, cache);
  return cache;
}

function getCache(name) {
  return registry.get(name) || null;
}

function getCacheNames() {
  return [...registry.keys()].sort();
}

function getAllCacheStats() {
  return getCacheNames().map((name) => registry.get(name).getStats());
}

function clearCaches(name = null) {
  if (name) {
    const cache = registry.get(name);
    if (!cache) throw new Error(`Unknown cache: ${name}`);
    return { [name]: cache.clear() };
  }
  return Object.fromEntries(getCacheNames().map((cacheName) => [cacheName, registry.get(cacheName).clear()]));
}

module.exports = {
  createCache,
  getCache,
  getCacheNames,
  getAllCacheStats,
  clearCaches,
};
