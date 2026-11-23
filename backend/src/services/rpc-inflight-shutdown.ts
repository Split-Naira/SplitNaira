/**
 * Track in-flight Stellar RPC calls across process shutdown (#1639).
 *
 * On shutdown: clear retry timers, abort waiters via AbortSignal, and classify
 * interrupted calls as unknown-outcome (same as timeout — do not assume failure
 * or success on-chain).
 */

import { classifyStellarFailure, type StellarFailureKind } from "./stellar-timeout.js";

export type InFlightRpcOutcome = "completed" | "aborted_shutdown" | "timed_out";

export interface InFlightRpcHandle {
  readonly id: string;
  readonly startedAt: number;
  readonly signal: AbortSignal;
}

type Timer = ReturnType<typeof setTimeout>;

const inflight = new Map<string, { controller: AbortController; timer?: Timer }>();
let shuttingDown = false;
let idSeq = 0;

export function resetRpcInflightForTests(): void {
  for (const entry of inflight.values()) {
    if (entry.timer) clearTimeout(entry.timer);
    try {
      entry.controller.abort();
    } catch {
      /* ignore */
    }
  }
  inflight.clear();
  shuttingDown = false;
  idSeq = 0;
}

export function isRpcShutdownInProgress(): boolean {
  return shuttingDown;
}

export function getInflightRpcCount(): number {
  return inflight.size;
}

/**
 * Register an in-flight RPC. Rejects new work once shutdown has started.
 */
export function beginRpcCall(timeoutMs = 30_000): InFlightRpcHandle {
  if (shuttingDown) {
    const controller = new AbortController();
    controller.abort();
    return { id: `shutdown-${idSeq++}`, startedAt: Date.now(), signal: controller.signal };
  }

  const id = `rpc-${idSeq++}`;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  // Allow process exit while only timers remain.
  timer.unref?.();
  inflight.set(id, { controller, timer });
  return { id, startedAt: Date.now(), signal: controller.signal };
}

export function endRpcCall(id: string): void {
  const entry = inflight.get(id);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  inflight.delete(id);
}

/**
 * Begin graceful RPC shutdown: mark flag, abort all in-flight signals, clear timers.
 * Does not claim on-chain success or failure for aborted calls.
 */
export function shutdownRpcInflight(): { aborted: number } {
  shuttingDown = true;
  let aborted = 0;
  for (const [id, entry] of inflight.entries()) {
    if (entry.timer) clearTimeout(entry.timer);
    if (!entry.controller.signal.aborted) {
      entry.controller.abort();
      aborted += 1;
    }
    inflight.delete(id);
  }
  return { aborted };
}

/**
 * Map an error observed around shutdown to a stable failure kind.
 * Aborted-during-shutdown is treated like timeout (unknown ledger outcome).
 */
export function classifyShutdownAwareFailure(error: unknown): StellarFailureKind {
  if (error instanceof Error) {
    const name = error.name.toLowerCase();
    const msg = error.message.toLowerCase();
    if (
      name === "aborterror" ||
      msg.includes("aborted") ||
      msg.includes("shutdown")
    ) {
      return "timeout";
    }
  }
  return classifyStellarFailure(error);
}

export function outcomeForAbortedCall(): InFlightRpcOutcome {
  return "aborted_shutdown";
}
