import { getActiveTransactionCount } from "./database.js";

/**
 * Issue #1638: bounded shutdown while database transactions are active.
 *
 * A payout transaction must be allowed to commit or roll back before the pool
 * is destroyed. Draining is bounded: once `timeoutMs` elapses the caller logs
 * the remaining transactions and proceeds (the process-level force timer is
 * the final backstop for a hung close). This module has no process/Express
 * imports so the sequence is unit-testable with fake dependencies.
 */

export const DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS = 10_000;
export const DEFAULT_SHUTDOWN_FORCE_TIMEOUT_MS = 15_000;
export const DEFAULT_DRAIN_POLL_INTERVAL_MS = 25;

export interface DrainActiveTransactionsOptions {
  /** Maximum time to wait for in-flight transactions to finish. */
  timeoutMs: number;
  pollIntervalMs?: number;
  getActiveCount?: () => number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface DrainResult {
  /** True only when no transaction remained open before the deadline. */
  drained: boolean;
  remaining: number;
  elapsedMs: number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Waits until `getActiveCount()` returns 0 or the deadline passes.
 *
 * A zero timeout is a valid boundary: it checks once and never sleeps, so a
 * shutdown with no in-flight work does not pay the poll interval.
 */
export async function drainActiveTransactions(
  options: DrainActiveTransactionsOptions,
): Promise<DrainResult> {
  const getActiveCount = options.getActiveCount ?? getActiveTransactionCount;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const pollIntervalMs = Math.max(1, options.pollIntervalMs ?? DEFAULT_DRAIN_POLL_INTERVAL_MS);

  const startedAt = now();
  let remaining = getActiveCount();

  while (remaining > 0) {
    const elapsedMs = now() - startedAt;
    const remainingBudgetMs = options.timeoutMs - elapsedMs;
    if (remainingBudgetMs <= 0) break;

    await sleep(Math.min(pollIntervalMs, remainingBudgetMs));
    remaining = getActiveCount();
  }

  return {
    drained: remaining === 0,
    remaining,
    elapsedMs: now() - startedAt,
  };
}

export type ShutdownLogLevel = "info" | "warn" | "error";

export interface ShutdownSequenceDeps {
  /** Flip readiness to 503 before anything is torn down. */
  markShuttingDown: () => void;
  /** End open SSE streams so `server.close()` can finish. */
  closeSseConnections: () => void;
  stopEventListener: () => void;
  /**
   * Starts `server.close()` and resolves when the listener has closed. It must
   * not reject: transport close errors are logged by the caller.
   */
  closeServer: () => Promise<void>;
  drainTransactions: (timeoutMs: number) => Promise<DrainResult>;
  closeDatabase: () => Promise<void>;
  /** Production wiring is `process.exit`. Tests inject a spy. */
  forceExit: (code: number) => void;
  log?: (level: ShutdownLogLevel, message: string, meta?: Record<string, unknown>) => void;
}

export interface ShutdownSequenceOptions {
  drainTimeoutMs?: number;
  forceTimeoutMs?: number;
}

export interface ShutdownSequenceResult {
  exitCode: 0 | 1;
  /** True when the force timer fired before the graceful work finished. */
  forced: boolean;
  /** Null only if the force timer fired before draining returned. */
  drain: DrainResult | null;
}

async function withForcedExit(
  work: Promise<void>,
  forceTimeoutMs: number,
  forceExit: (code: number) => void,
): Promise<"done" | "forced"> {
  let timer: NodeJS.Timeout | undefined;
  const forced = new Promise<"forced">((resolve) => {
    timer = setTimeout(() => {
      forceExit(1);
      resolve("forced");
    }, forceTimeoutMs);
    timer.unref?.();
  });

  try {
    return await Promise.race([work.then(() => "done" as const), forced]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Runs shutdown in a load-balancer-safe order:
 *
 *   readiness -> stop new connections -> drain SSE -> stop listener ->
 *   drain in-flight transactions -> close DB -> server closed -> exit
 *
 * The database is deliberately closed *after* draining, so an active payout
 * can still commit or roll back. If the drain deadline passes, shutdown
 * continues and exits 1 (the work was not graceful); the force timer is the
 * backstop for a hung close and exits 1 immediately.
 */
export async function runShutdownSequence(
  deps: ShutdownSequenceDeps,
  options: ShutdownSequenceOptions = {},
): Promise<ShutdownSequenceResult> {
  const drainTimeoutMs = options.drainTimeoutMs ?? DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS;
  const forceTimeoutMs = options.forceTimeoutMs ?? DEFAULT_SHUTDOWN_FORCE_TIMEOUT_MS;
  // A mutable holder is used instead of a `let`: TypeScript does not track
  // assignments made inside the async closure for control-flow narrowing.
  const drainRef: { current: DrainResult | null } = { current: null };

  const work = (async () => {
    deps.markShuttingDown();
    deps.closeSseConnections();
    deps.stopEventListener();

    // Stop accepting new connections first; existing requests keep their
    // pooled connections and are awaited below.
    const serverClosed = deps.closeServer();

    const drain = await deps.drainTransactions(drainTimeoutMs);
    drainRef.current = drain;
    if (!drain.drained) {
      deps.log?.("warn", "Timed out draining active database transactions", {
        remaining: drain.remaining,
        drainTimeoutMs,
      });
    }

    await deps.closeDatabase();
    await serverClosed;
  })();

  const outcome = await withForcedExit(work, forceTimeoutMs, deps.forceExit);
  if (outcome === "forced") {
    return { exitCode: 1, forced: true, drain: drainRef.current };
  }

  const exitCode = drainRef.current?.drained ? 0 : 1;
  deps.forceExit(exitCode);
  return { exitCode, forced: false, drain: drainRef.current };
}
