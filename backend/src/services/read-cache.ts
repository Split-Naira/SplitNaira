/**
 * Bounded TTL cache for read-only Soroban simulation results.
 * Prevents unbounded memory growth while reducing RPC load under read-heavy traffic.
 * Uses LRU eviction: the least recently accessed entry is removed when capacity is full.
 *
 * Issue #1033: Supports in-flight coalescing — when multiple concurrent callers
 * request the same cache key while the upstream call is still pending, they all
 * await the same Promise instead of firing duplicate RPC requests.
 */

export interface ReadCacheOptions {
  defaultTtlMs?: number;
  maxEntries?: number;
}

export interface ReadCacheStats {
  size: number;
  keys: string[];
  hits: number;
  misses: number;
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
  /** Issue #1033: tracks in-flight promises per cache key for coalescing. */
  private readonly inflight = new Map<string, Promise<unknown>>();
  private hits = 0;
  private misses = 0;

  constructor(options: ReadCacheOptions = {}) {
    this.defaultTtlMs = options.defaultTtlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.misses++;
      return undefined;
    }
    this.hits++;
    entry.lastAccessedAt = Date.now();
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  /**
   * Issue #1033: Returns a cached value if present, or coalesces concurrent
   * callers onto the same in-flight Promise. The `fetcher` is only called
   * once per cache key while a prior call is still pending.
   *
   * When the fetcher resolves successfully, the result is cached with the
   * default TTL. When it rejects, the in-flight entry is removed so
   * subsequent callers can retry.
   */
  async getOrFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) {
      return cached;
    }

    const existing = this.inflight.get(key) as Promise<T> | undefined;
    if (existing) {
      return existing;
    }

    let promise: Promise<T>;
    promise = fetcher()
      .then((value) => {
        if (this.inflight.get(key) === promise) {
          this.set(key, value);
        }
        return value;
      })
      .finally(() => {
        if (this.inflight.get(key) === promise) {
          this.inflight.delete(key);
        }
      });

    this.inflight.set(key, promise);
    return promise;
  }

  set<T>(key: string, value: T, ttlMs = this.defaultTtlMs): void {
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      this.evictLRU();
    }
    const now = Date.now();
    this.store.set(key, { value, expiresAt: now + ttlMs, lastAccessedAt: now });
  }

  delete(key: string): boolean {
    const deleted = this.store.delete(key);
    this.inflight.delete(key);
    return deleted;
  }

  deleteByPrefix(prefix: string): number {
    let removed = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        removed++;
      }
    }
    for (const key of this.inflight.keys()) {
      if (key.startsWith(prefix)) {
        this.inflight.delete(key);
      }
    }
    return removed;
  }

  clear(): void {
    this.store.clear();
    this.inflight.clear();
  }

  stats(): ReadCacheStats {
    this.purgeExpired();
    return {
      size: this.store.size,
      keys: Array.from(this.store.keys()),
      hits: this.hits,
      misses: this.misses,
    };
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
    const lruKey = this.store.keys().next().value;
    if (lruKey !== undefined) {
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
