import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReadCache, configureReadCache, getReadCache, resetReadCacheForTests } from "./read-cache.js";

describe("ReadCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetReadCacheForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetReadCacheForTests();
  });

  it("returns cached values before TTL expires", () => {
    const cache = new ReadCache({ defaultTtlMs: 1000 });
    cache.set("project:abc", { id: "abc" });

    vi.advanceTimersByTime(500);

    expect(cache.get("project:abc")).toEqual({ id: "abc" });
  });

  it("expires entries after TTL", () => {
    const cache = new ReadCache({ defaultTtlMs: 1000 });
    cache.set("project:abc", { id: "abc" });

    vi.advanceTimersByTime(1001);

    expect(cache.get("project:abc")).toBeUndefined();
  });

  it("evicts the oldest entry when max size is reached", () => {
    const cache = new ReadCache({ defaultTtlMs: 60_000, maxEntries: 2 });
    cache.set("a", 1, 1000);
    vi.advanceTimersByTime(10);
    cache.set("b", 2, 2000);
    vi.advanceTimersByTime(10);
    cache.set("c", 3, 3000);

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
  });

  it("invalidates by prefix", () => {
    const cache = new ReadCache();
    cache.set("list_projects:0:10", []);
    cache.set("list_projects:10:10", []);
    cache.set("project:xyz", {});

    expect(cache.deleteByPrefix("list_projects:")).toBe(2);
    expect(cache.get("list_projects:0:10")).toBeUndefined();
    expect(cache.get("project:xyz")).toEqual({});
  });

  it("reports size after purging expired keys", () => {
    const cache = new ReadCache({ defaultTtlMs: 500 });
    cache.set("k1", 1);
    cache.set("k2", 2);
    vi.advanceTimersByTime(600);

    expect(cache.stats().size).toBe(0);
  });

  it("preserves recently accessed key under LRU eviction", () => {
    const cache = new ReadCache({ defaultTtlMs: 60_000, maxEntries: 3 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    cache.get("a");
    cache.get("b");
    cache.set("d", 4);

    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBe(2);
    expect(cache.get("d")).toBe(4);
    expect(cache.get("c")).toBeUndefined();
  });

  it("tracks hits and misses in stats", () => {
    const cache = new ReadCache({ defaultTtlMs: 60_000 });
    cache.set("existing", 42);

    cache.get("existing");
    cache.get("missing");
    cache.get("existing");

    const stats = cache.stats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
  });

  it("counts expired entry access as miss not hit", () => {
    const cache = new ReadCache({ defaultTtlMs: 500 });
    cache.set("ephemeral", "value");

    vi.advanceTimersByTime(600);

    cache.get("ephemeral");

    const stats = cache.stats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(1);
  });
});

describe("getReadCache", () => {
  afterEach(() => {
    resetReadCacheForTests();
  });

  it("returns a singleton instance", () => {
    const a = getReadCache();
    const b = getReadCache();
    expect(a).toBe(b);
  });

  it("applies configureReadCache options", () => {
    const cache = configureReadCache({ maxEntries: 1, defaultTtlMs: 100 });
    cache.set("only", true);
    cache.set("second", true);

    expect(cache.get("only")).toBeUndefined();
    expect(cache.get("second")).toBe(true);
  });
});
