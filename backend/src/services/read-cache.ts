/**
 * Bounded TTL cache for read-only Soroban simulation results.
 * Prevents unbounded memory growth while reducing RPC load under read-heavy traffic.
 */

export interface ReadCacheOptions {
  defaultTtlMs?: number;
  maxEntries?: number;
}

export interface ReadCacheStats {
  size: number;
  keys: string[];
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_MAX_ENTRIES = 500;

export class ReadCache {
  private readonly defaultTtlMs: number;
  private readonly maxEntries: number;
  private readonly store = new Map<string, CacheEntry<unknown>>();

  constructor(options: ReadCacheOptions = {}) {
    this.defaultTtlMs = options.defaultTtlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) {
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set<T>(key: string, value: T, ttlMs = this.defaultTtlMs): void {
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      this.evictOldest();
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  deleteByPrefix(prefix: string): number {
    let removed = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        removed++;
      }
    }
    return removed;
  }

  clear(): void {
    this.store.clear();
  }

  stats(): ReadCacheStats {
    this.purgeExpired();
    return { size: this.store.size, keys: Array.from(this.store.keys()) };
  }

  private purgeExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestExpiry = Infinity;
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt < oldestExpiry) {
        oldestExpiry = entry.expiresAt;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      this.store.delete(oldestKey);
    }
  }
}

/** Process-wide read cache used by Stellar RPC read paths. */
let sharedReadCache: ReadCache | null = null;

export function configureReadCache(options: ReadCacheOptions): ReadCache {
  sharedReadCache = new ReadCache(options);
  return sharedReadCache;
}

export function getReadCache(): ReadCache {
  if (!sharedReadCache) {
    sharedReadCache = new ReadCache();
  }
  return sharedReadCache;
}

/** @internal Test helper */
export function resetReadCacheForTests(): void {
  sharedReadCache = null;
}
