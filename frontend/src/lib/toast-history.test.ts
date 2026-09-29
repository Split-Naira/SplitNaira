/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from "vitest";

import {
  TOAST_HISTORY_LIMIT,
  TOAST_HISTORY_STORAGE_KEY,
  appendToastHistory,
  clearToastHistory,
  isPersistableVariant,
  readToastHistory,
  type ToastHistoryEntry,
} from "./toast-history";

const entry = (
  index: number,
  overrides: Partial<ToastHistoryEntry> = {},
): ToastHistoryEntry => ({
  id: `toast-${index}`,
  message: `failure ${index}`,
  variant: "error",
  createdAt: 1_700_000_000_000 + index,
  ...overrides,
});

/** A Storage stand-in that fails every operation, like private browsing can. */
const brokenStorage = {
  getItem: () => {
    throw new Error("storage disabled");
  },
  setItem: () => {
    throw new Error("storage disabled");
  },
  removeItem: () => {
    throw new Error("storage disabled");
  },
} as unknown as Storage;

beforeEach(() => {
  window.localStorage.clear();
});

describe("isPersistableVariant", () => {
  it("keeps failures and drops confirmations and advisories", () => {
    expect(isPersistableVariant("error")).toBe(true);
    expect(isPersistableVariant("success")).toBe(false);
    expect(isPersistableVariant("info")).toBe(false);
    expect(isPersistableVariant("warning")).toBe(false);
  });
});

describe("readToastHistory", () => {
  it("returns an empty history when nothing has been stored", () => {
    expect(readToastHistory()).toEqual([]);
    expect(readToastHistory(null)).toEqual([]);
  });

  it("returns the stored entries in the order they were recorded", () => {
    appendToastHistory(entry(1));
    appendToastHistory(entry(2));

    expect(readToastHistory().map((e) => e.id)).toEqual(["toast-1", "toast-2"]);
  });

  it("survives a corrupted stored value instead of throwing", () => {
    window.localStorage.setItem(TOAST_HISTORY_STORAGE_KEY, "{not json");

    expect(readToastHistory()).toEqual([]);
  });

  it("rejects a stored value that is not an array", () => {
    window.localStorage.setItem(
      TOAST_HISTORY_STORAGE_KEY,
      JSON.stringify({ id: "toast-1" }),
    );

    expect(readToastHistory()).toEqual([]);
  });

  it("drops malformed rows but keeps the valid ones", () => {
    window.localStorage.setItem(
      TOAST_HISTORY_STORAGE_KEY,
      JSON.stringify([
        entry(1),
        { id: "missing-fields" },
        { ...entry(2), createdAt: "not-a-number" },
        { ...entry(3), variant: "success" },
        entry(4),
      ]),
    );

    expect(readToastHistory().map((e) => e.id)).toEqual(["toast-1", "toast-4"]);
  });

  it("caps an oversized stored value at the history limit, keeping the newest", () => {
    const oversized = Array.from({ length: TOAST_HISTORY_LIMIT + 5 }, (_, i) =>
      entry(i),
    );
    window.localStorage.setItem(
      TOAST_HISTORY_STORAGE_KEY,
      JSON.stringify(oversized),
    );

    const history = readToastHistory();
    expect(history).toHaveLength(TOAST_HISTORY_LIMIT);
    expect(history[history.length - 1].id).toBe(
      `toast-${TOAST_HISTORY_LIMIT + 4}`,
    );
  });

  it("returns an empty history when storage access itself throws", () => {
    expect(readToastHistory(brokenStorage)).toEqual([]);
  });
});

describe("appendToastHistory", () => {
  it("persists the new entry and returns the updated history", () => {
    const history = appendToastHistory(entry(1));

    expect(history.map((e) => e.id)).toEqual(["toast-1"]);
    expect(JSON.parse(window.localStorage.getItem(TOAST_HISTORY_STORAGE_KEY) ?? "[]")).toHaveLength(1);
  });

  it("drops the oldest entry once the limit is reached", () => {
    for (let i = 0; i < TOAST_HISTORY_LIMIT; i += 1) {
      appendToastHistory(entry(i));
    }

    const history = appendToastHistory(entry(TOAST_HISTORY_LIMIT));

    expect(history).toHaveLength(TOAST_HISTORY_LIMIT);
    expect(history[0].id).toBe("toast-1");
    expect(history[history.length - 1].id).toBe(
      `toast-${TOAST_HISTORY_LIMIT}`,
    );
  });

  it("still returns the in-memory history when the write fails", () => {
    const history = appendToastHistory(entry(1), brokenStorage);

    expect(history.map((e) => e.id)).toEqual(["toast-1"]);
  });
});

describe("clearToastHistory", () => {
  it("removes every persisted entry", () => {
    appendToastHistory(entry(1));
    appendToastHistory(entry(2));

    clearToastHistory();

    expect(readToastHistory()).toEqual([]);
    expect(window.localStorage.getItem(TOAST_HISTORY_STORAGE_KEY)).toBeNull();
  });

  it("does not throw when storage access fails", () => {
    expect(() => clearToastHistory(brokenStorage)).not.toThrow();
  });

  it("is a no-op without a storage implementation", () => {
    expect(() => clearToastHistory(null)).not.toThrow();
  });
});
