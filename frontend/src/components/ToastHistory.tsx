"use client";

import { useState } from "react";
import type { ToastHistoryEntry } from "@/lib/toast-history";

export interface ToastHistoryPanelProps {
  /** Oldest-first failure history, as returned by `readToastHistory`. */
  entries: ToastHistoryEntry[];
  /** Wipes both the rendered list and the persisted copy. */
  onClear: () => void;
}

/**
 * Collapsed-by-default review surface for persisted failure toasts (#1109).
 *
 * Renders nothing until there is something to review, so it is safe to mount
 * unconditionally next to the toast container. The trigger carries the count in
 * its accessible name, which is what a screen-reader user hears; the entries
 * live in a labelled region that is only in the tree while expanded.
 */
export function ToastHistoryPanel({ entries, onClear }: ToastHistoryPanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (entries.length === 0) return null;

  const newestFirst = entries.slice().reverse();

  return (
    <div className="fixed bottom-4 right-4 z-[9998] flex w-full max-w-sm flex-col items-end gap-2 pointer-events-none">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-controls="toast-history-region"
        className="pointer-events-auto rounded-2xl border border-white/10 bg-[#191A1D] px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-muted shadow-lg transition-colors hover:text-ink"
      >
        Failure history ({entries.length})
      </button>

      {isOpen && (
        <div
          id="toast-history-region"
          role="region"
          aria-label="Recent transaction failures"
          data-testid="toast-history-region"
          className="pointer-events-auto w-full rounded-2xl border border-white/10 bg-[#191A1D] p-4 shadow-xl"
        >
          <div className="mb-3 flex items-center justify-between gap-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">
              Recent failures
            </p>
            <button
              type="button"
              onClick={onClear}
              className="text-[10px] font-bold uppercase tracking-widest text-red-300 underline underline-offset-4 transition-colors hover:text-red-200"
            >
              Clear
            </button>
          </div>

          <ul className="max-h-64 space-y-3 overflow-y-auto pr-1">
            {newestFirst.map((entry) => (
              <li key={entry.id} data-testid="toast-history-entry">
                <time
                  dateTime={new Date(entry.createdAt).toISOString()}
                  className="font-mono text-[10px] text-muted/70"
                >
                  {new Date(entry.createdAt).toLocaleTimeString()}
                </time>
                <p className="text-sm leading-snug text-ink">{entry.message}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
