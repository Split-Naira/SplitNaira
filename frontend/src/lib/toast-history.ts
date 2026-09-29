/**
 * Persistent history for failure toasts (#1109).
 *
 * The toast surface is deliberately transient: a failure is shown for a few
 * seconds and then gone. For a transaction failure that is the worst possible
 * moment to lose the message — the user is mid-task, the wallet is focused, and
 * by the time they look back the reason is no longer on screen.
 *
 * This module keeps the last {@link TOAST_HISTORY_LIMIT} failure toasts in
 * `localStorage` so the UI can offer a "failure history" affordance that
 * survives both the toast timeout and a full page reload.
 *
 * Scope decision: only `error` toasts are persisted. Success and info toasts
 * are confirmations whose outcome is already reflected in the UI, and warnings
 * are advisory (the wallet guard uses them for "reconnect"), so recording them
 * would turn the history into a log of everything that ever happened.
 *
 * Every function here is total: private-browsing modes, disabled storage and
 * corrupt JSON all degrade to "no history" rather than throwing into render.
 */

import type { ToastVariant } from "@/components/toast-provider";

/** Versioned so a future shape change can migrate instead of mis-parsing. */
export const TOAST_HISTORY_STORAGE_KEY = "splitnaira:toast-history:v1";

/** Bounded so a long-lived session cannot grow storage without limit. */
export const TOAST_HISTORY_LIMIT = 20;

export interface ToastHistoryEntry {
  /** Unique id of the toast that produced the entry. */
  id: string;
  message: string;
  variant: ToastVariant;
  /** Epoch milliseconds, so the UI can render a timestamp. */
  createdAt: number;
}

const PERSISTED_VARIANTS: readonly ToastVariant[] = ["error"];

/**
 * Whether a toast variant is worth keeping. Failures are; the rest are not.
 */
export function isPersistableVariant(variant: ToastVariant): boolean {
  return PERSISTED_VARIANTS.includes(variant);
}

function isToastHistoryEntry(value: unknown): value is ToastHistoryEntry {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.message === "string" &&
    typeof candidate.createdAt === "number" &&
    Number.isFinite(candidate.createdAt) &&
    typeof candidate.variant === "string" &&
    PERSISTED_VARIANTS.includes(candidate.variant as ToastVariant)
  );
}

/**
 * Resolves `localStorage`, or null when it is unavailable.
 *
 * `window.localStorage` itself throws in some privacy configurations, so the
 * access has to be inside the try.
 */
function resolveStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Reads persisted entries, oldest first.
 *
 * Malformed rows are dropped individually rather than discarding the whole
 * history, and the result is capped so an oversized stored value (for example
 * one written by an older, unbounded version) cannot flood the UI.
 */
export function readToastHistory(
  storage: Storage | null = resolveStorage(),
): ToastHistoryEntry[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(TOAST_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isToastHistoryEntry).slice(-TOAST_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function writeToastHistory(
  entries: ToastHistoryEntry[],
  storage: Storage | null,
): void {
  if (!storage) return;
  try {
    storage.setItem(TOAST_HISTORY_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota exceeded or storage disabled mid-session: keep the in-memory
    // history the caller already holds rather than failing the toast.
  }
}

/**
 * Appends an entry and returns the new history (oldest first).
 *
 * The returned value is always the source of truth for the caller, so the
 * in-memory list and the persisted list cannot drift when a write fails.
 */
export function appendToastHistory(
  entry: ToastHistoryEntry,
  storage: Storage | null = resolveStorage(),
): ToastHistoryEntry[] {
  const next = [...readToastHistory(storage), entry].slice(-TOAST_HISTORY_LIMIT);
  writeToastHistory(next, storage);
  return next;
}

/** Removes every persisted entry. */
export function clearToastHistory(
  storage: Storage | null = resolveStorage(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(TOAST_HISTORY_STORAGE_KEY);
  } catch {
    // Nothing actionable: the caller clears its in-memory copy regardless.
  }
}
