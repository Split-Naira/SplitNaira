/**
 * Bounded TTL cache for read-only Soroban simulation results.
 * Prevents unbounded memory growth while reducing RPC load under read-heavy traffic.
 * Uses LRU eviction: the least recently accessed entry is removed when capacity is full.
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
  lastAccessedAt: number;
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
    entry.lastAccessedAt = Date.now();
    return entry.value;
  }

  set<T>(key: string, value: T, ttlMs = this.defaultTtlMs): void {
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      this.evictLRU();
    }
    const now = Date.now();
    this.store.set(key, { value, expiresAt: now + ttlMs, lastAccessedAt: now });
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

  private evictLRU(): void {
    let lruKey: string | null = null;
    let lruAccess = Infinity;
    for (const [key, entry] of this.store.entries()) {
      if (entry.lastAccessedAt < lruAccess) {
        lruAccess = entry.lastAccessedAt;
        lruKey = key;
      }
    }
    if (lruKey) {
      this.store.delete(lruKey);
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
