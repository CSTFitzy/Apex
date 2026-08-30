/**
 * Lightweight in-process TTL cache.
 *
 * Used to avoid repeatedly hitting PostgreSQL for hot, read-heavy data such
 * as the unit roster during an active simulation. Entries expire after a
 * configurable TTL and the cache is bounded so it cannot grow without limit.
 *
 * This deliberately stays in-process (rather than using Redis) so that cache
 * reads cost no network round trip; Redis remains available for cross-process
 * fan-out via the WebSocket broadcast path.
 */

const DEFAULT_TTL_MS = Number(process.env.CACHE_TTL_MS) || 5000;
const DEFAULT_MAX_ENTRIES = Number(process.env.CACHE_MAX_ENTRIES) || 500;

export class TTLCache {
  constructor({ ttlMs = DEFAULT_TTL_MS, maxEntries = DEFAULT_MAX_ENTRIES } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.store = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  /** Return the cached value for `key`, or undefined when missing/expired. */
  get(key) {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      this.misses += 1;
      return undefined;
    }
    // Refresh recency for the (approximate) LRU eviction order.
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits += 1;
    return entry.value;
  }

  /** Store a value under `key`, evicting the least recently used entry if full. */
  set(key, value, ttlMs = this.ttlMs) {
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });

    while (this.store.size > this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      this.store.delete(oldestKey);
    }
    return value;
  }

  /** Remove a single key. */
  delete(key) {
    return this.store.delete(key);
  }

  /** Drop every entry (used when the underlying data changes). */
  clear() {
    this.store.clear();
  }

  /**
   * Return the cached value for `key`, or compute, store and return it.
   * @param {string} key
   * @param {() => Promise<*>} loader - Called only on a cache miss.
   */
  async getOrSet(key, loader, ttlMs = this.ttlMs) {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = await loader();
    this.set(key, value, ttlMs);
    return value;
  }

  /** Basic hit/miss statistics, useful for the health endpoint. */
  stats() {
    return { size: this.store.size, hits: this.hits, misses: this.misses, ttlMs: this.ttlMs };
  }
}

/** Shared cache for unit/force lookups, which are read on every simulation tick. */
export const unitCache = new TTLCache();

export default TTLCache;
