import { getStellarRpcServer, loadStellarConfig, executeWithRetry } from "./stellar.js";
import { getDataSource } from "./database.js";
import { TransactionRecord } from "../entities/Transaction.js";
import { ServiceState } from "../entities/ServiceState.js";
import { logger } from "./logger.js";
import { scValToNative } from "@stellar/stellar-sdk";
import { fetchProjectById } from "./splits.service.js";
import { publishSseEvent } from "./SseEventBus.js";
import { getEventBus, TRANSACTION_CONFIRMED } from "./EventBus.js";

// Polling cadence. Under normal operation we poll every 5s. After a streak of
// consecutive RPC failures we back off to 30s to avoid hammering an RPC that is
// down, then return to the normal cadence on the first successful poll.
export const NORMAL_POLL_INTERVAL_MS = 5_000;
export const BACKOFF_POLL_INTERVAL_MS = 30_000;
export const ERROR_THRESHOLD = 3;

// Catch-up safety. If, on (re)start, the ledger we would resume from is more
// than this many ledgers behind the chain tip, we skip ahead so a prolonged
// outage cannot flood the RPC with thousands of catch-up requests.
export const MAX_CATCHUP_LEDGERS = 10_000;
const STARTUP_LOOKBACK_LEDGERS = 100;

// Key under which the polling cursor is persisted in ServiceState so it
// survives process restarts.
export const EVENT_LISTENER_CURSOR_KEY = "event_listener_cursor";
// The cursor is opaque, so retain the corresponding ledger separately for
// operational lag monitoring across restarts.
export const EVENT_LISTENER_LAST_PROCESSED_LEDGER_KEY =
  "event_listener_last_processed_ledger";

export type ServiceStatus = "stopped" | "healthy" | "degraded";

let pollInterval: NodeJS.Timeout | null = null;
let isPolling = false;
let startLedger: number | null = null;
let cursor: string | null = null;

// Resilience state.
let consecutiveErrors = 0;
let lastSuccessfulPoll: string | null = null;
let currentPollDelayMs = NORMAL_POLL_INTERVAL_MS;
let latestObservedLedger: number | null = null;
let lastProcessedLedger: number | null = null;
let lastLedgerObservationAt: string | null = null;

export interface EventListenerLedgerLag {
  latestLedger: number | null;
  lastProcessedLedger: number | null;
  lag: number | null;
  observedAt: string | null;
}

/**
 * Returns the listener's distance from the latest ledger seen in a successful
 * `getEvents` response. `lag` is null until the worker has processed an event
 * ledger (for example immediately after a cursor-only restart).
 */
export function getLedgerLag(): EventListenerLedgerLag {
  const lag = latestObservedLedger !== null && lastProcessedLedger !== null
    ? Math.max(0, latestObservedLedger - lastProcessedLedger)
    : null;

  return {
    latestLedger: latestObservedLedger,
    lastProcessedLedger,
    lag,
    observedAt: lastLedgerObservationAt,
  };
}

/**
 * (Re)arms the polling timer at the requested cadence. Idempotent: if the timer
 * is already running at `delayMs`, it is left untouched so we don't churn timers
 * on every poll.
 */
function schedulePolling(delayMs: number): void {
  if (pollInterval && currentPollDelayMs === delayMs) {
    return;
  }

  if (pollInterval) {
    clearInterval(pollInterval);
  }

  currentPollDelayMs = delayMs;
  pollInterval = setInterval(() => {
    void pollEvents();
  }, delayMs);
}

/**
 * Caps how far back polling may resume. If `desiredStartLedger` is more than
 * {@link MAX_CATCHUP_LEDGERS} behind `latestLedger`, returns a ledger that is
 * exactly `MAX_CATCHUP_LEDGERS` behind the tip and logs a warning. Otherwise
 * returns `desiredStartLedger` unchanged.
 */
export function capCatchUpWindow(
  latestLedger: number,
  desiredStartLedger: number
): number {
  if (latestLedger - desiredStartLedger > MAX_CATCHUP_LEDGERS) {
    const capped = latestLedger - MAX_CATCHUP_LEDGERS;
    logger.warn(
      `EventListenerService: requested start ledger ${desiredStartLedger} is more than ${MAX_CATCHUP_LEDGERS} ledgers behind tip ${latestLedger}; advancing to ${capped} to bound catch-up.`
    );
    return capped;
  }
  return desiredStartLedger;
}

export async function startEventListenerService() {
  if (pollInterval) {
    logger.warn("EventListenerService is already running");
    return;
  }

  logger.info("Starting EventListenerService background worker...");

  consecutiveErrors = 0;

  try {
    const server = getStellarRpcServer();
    const stateRepo = getDataSource().getRepository(ServiceState);
    const persistedCursor = await stateRepo.findOneBy({ key: EVENT_LISTENER_CURSOR_KEY });
    const persistedLedger = await stateRepo.findOneBy({
      key: EVENT_LISTENER_LAST_PROCESSED_LEDGER_KEY,
    });
    const parsedPersistedLedger = Number(persistedLedger?.value);
    lastProcessedLedger = Number.isSafeInteger(parsedPersistedLedger) && parsedPersistedLedger >= 0
      ? parsedPersistedLedger
      : null;

    if (persistedCursor?.value) {
      cursor = persistedCursor.value;
      startLedger = null;
      logger.info("Initialized EventListenerService from persisted cursor");
      schedulePolling(NORMAL_POLL_INTERVAL_MS);
      return;
    }

    const latestLedger = await executeWithRetry(() => server.getLatestLedger(), {
      operation: "getLatestLedger"
    });

    // Start polling from a small lookback to cover restart gaps, but never more
    // than MAX_CATCHUP_LEDGERS behind the tip.
    const desiredStart = Math.max(1, latestLedger.sequence - STARTUP_LOOKBACK_LEDGERS);
    startLedger = capCatchUpWindow(latestLedger.sequence, desiredStart);

    logger.info(
      `Initialized EventListenerService to start polling from ledger: ${startLedger}`
    );
  } catch (error) {
    logger.error(
      "Failed to determine EventListenerService start position. Polling from latest.",
      { error }
    );
  }

  schedulePolling(NORMAL_POLL_INTERVAL_MS);
}

export function stopEventListenerService() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    currentPollDelayMs = NORMAL_POLL_INTERVAL_MS;
    consecutiveErrors = 0;
    logger.info("EventListenerService background worker stopped cleanly.");
  }
}

/**
 * Health snapshot consumed by the readiness health check.
 *
 * - `status`: `stopped` (not running), `healthy` (running, no failure streak),
 *   or `degraded` (running but in an RPC failure back-off).
 * - `lastSuccessfulPoll`: ISO timestamp of the last poll that completed without
 *   error, or `null` if none yet.
 * - `consecutiveErrors`: number of consecutive failing polls.
 */
export function getServiceHealth(): {
  status: ServiceStatus;
  lastSuccessfulPoll: string | null;
  consecutiveErrors: number;
} {
  let status: ServiceStatus;
  if (!pollInterval) {
    status = "stopped";
  } else if (consecutiveErrors >= ERROR_THRESHOLD) {
    status = "degraded";
  } else {
    status = "healthy";
  }

  return { status, lastSuccessfulPoll, consecutiveErrors };
}

/** Records a failed poll and backs off the cadence once the threshold is hit. */
function recordPollFailure(error: unknown): void {
  consecutiveErrors += 1;
  logger.error("Error occurred in background Soroban event poll", {
    error,
    consecutiveErrors,
  });

  if (consecutiveErrors >= ERROR_THRESHOLD && currentPollDelayMs !== BACKOFF_POLL_INTERVAL_MS) {
    logger.warn(
      `EventListenerService: ${consecutiveErrors} consecutive poll failures; backing off poll interval to ${BACKOFF_POLL_INTERVAL_MS}ms.`
    );
    schedulePolling(BACKOFF_POLL_INTERVAL_MS);
  }
}

/** Records a successful poll and resets the cadence after a failure streak. */
function recordPollSuccess(): void {
  if (consecutiveErrors > 0) {
    logger.info(
      `EventListenerService: recovered after ${consecutiveErrors} consecutive failure(s).`
    );
  }
  consecutiveErrors = 0;
  lastSuccessfulPoll = new Date().toISOString();

  if (currentPollDelayMs !== NORMAL_POLL_INTERVAL_MS) {
    logger.info(
      `EventListenerService: resetting poll interval to ${NORMAL_POLL_INTERVAL_MS}ms after recovery.`
    );
    schedulePolling(NORMAL_POLL_INTERVAL_MS);
  }
}

export async function pollEvents() {
  if (isPolling) return;

  isPolling = true;

  try {
    const config = loadStellarConfig();
    const server = getStellarRpcServer();
    const dataSource = getDataSource();
    const repo = dataSource.getRepository(TransactionRecord);

    const filters = [
      {
        type: "contract" as const,
        contractIds: [config.contractId],
      },
    ];

    const filterOptions: Parameters<typeof server.getEvents>[0] = cursor
      ? { filters, cursor, limit: 100 }
      : startLedger
      ? { filters, startLedger, limit: 100 }
      : { filters, cursor: "", limit: 100 };

    const response = await executeWithRetry(() => server.getEvents(filterOptions), {
      operation: "getEvents"
    });
    // `latestLedger` and each event's `ledger` are supplied by Soroban RPC,
    // but are optional in the SDK response type for compatibility with older
    // RPC servers.
    const ledgerResponse = response as typeof response & {
      latestLedger?: number;
      events?: Array<{ ledger?: number }>;
    };
    if (Number.isSafeInteger(ledgerResponse.latestLedger)) {
      latestObservedLedger = ledgerResponse.latestLedger!;
      lastLedgerObservationAt = new Date().toISOString();
    }
    const responseEvents = ledgerResponse.events ?? [];
    // An empty successful query has scanned through `latestLedger`, even if
    // the contract emitted no matching events. Treat that as caught up so a
    // quiet contract still exports a useful zero-lag gauge.
    const batchLastProcessedLedger = Math.max(
      lastProcessedLedger ?? 0,
      ...(responseEvents
        .map((event) => event.ledger)
        .filter((ledger): ledger is number => Number.isSafeInteger(ledger))),
      responseEvents.length === 0 ? latestObservedLedger ?? 0 : 0,
    );

    const newRecords: TransactionRecord[] = [];

    for (const event of response?.events ?? []) {
      try {
        const topics = event.topic.map((topic) => {
          try {
            return String(scValToNative(topic));
          } catch {
            return "";
          }
        });

        const eventName = topics[0] || "";
        if (
          eventName !== "payment_sent" &&
          eventName !== "collaborator_claimed" &&
          eventName !== "distribution_complete"
        ) {
          continue;
        }
        const projectId = topics[1] || "";
        const txHash = event.txHash;
        const timestamp = Math.floor(new Date(event.ledgerClosedAt).getTime() / 1000);

        if (eventName === "distribution_complete") {
          logger.info("Indexed milestone event", {
            eventName,
            projectId,
            txHash,
            ledgerClosedAt: event.ledgerClosedAt,
          });
          continue;
        }
        // Skip already-indexed transactions. The DB also enforces uniqueness
        // on txHash, but this avoids redundant work during polling.
        const decoded = scValToNative(event.value) as [string, string | number | bigint, number?];
        const recipient = String(decoded[0]);
        const amount = String(decoded[1]);

        const existing = await repo.findOneBy({ txHash });
        if (existing) {
          continue;
        }

        // Resolve the project's token address; fall back to "Native".
        let token = "Native";
        try {
          const project = await fetchProjectById(projectId);
          if (project && typeof project === "object" && "token" in project) {
            token = String(project.token);
          }
        } catch (err) {
          logger.warn(
            `Could not resolve token address for project ${projectId}. Using fallback.`,
            { err }
          );
        }

        newRecords.push(
          repo.create({
            roundId: projectId,
            recipient,
            amount,
            token,
            timestamp,
            txHash,
            status: "completed",
          })
        );
      } catch (eventError) {
        logger.error("Error processing polled Soroban event", {
          event,
          error: eventError,
        });
      }
    }

    const nextCursor = response?.cursor ?? cursor;

    // Persist the new records AND the advanced cursor in a single transaction,
    // so after a restart we never skip events relative to what was committed,
    // nor re-process a batch that was already committed (Issue #619).
    if (
      newRecords.length > 0 ||
      (nextCursor && nextCursor !== cursor) ||
      batchLastProcessedLedger > (lastProcessedLedger ?? 0)
    ) {
      await dataSource.transaction(async (manager) => {
        if (newRecords.length > 0) {
          await manager.upsert(TransactionRecord, newRecords, {
            conflictPaths: ["txHash"],
            skipUpdateIfNoValuesChanged: true,
          });
        }
        if (nextCursor) {
          await manager.upsert(
            ServiceState,
            { key: EVENT_LISTENER_CURSOR_KEY, value: nextCursor },
            { conflictPaths: ["key"] }
          );
        }
        if (batchLastProcessedLedger > (lastProcessedLedger ?? 0)) {
          await manager.upsert(
            ServiceState,
            {
              key: EVENT_LISTENER_LAST_PROCESSED_LEDGER_KEY,
              value: String(batchLastProcessedLedger),
            },
            { conflictPaths: ["key"] }
          );
        }
      });

      if (newRecords.length > 0) {
        logger.info(
          `Upserted ${newRecords.length} transaction record(s) from current event batch.`
        );

        // Real-time push: notify the generic event bus (Issue #618) and the
        // txHash-keyed SSE bus so connected clients are updated immediately.
        for (const record of newRecords) {
          getEventBus().emit(TRANSACTION_CONFIRMED, record);
          publishSseEvent(record.txHash, {
            txHash: record.txHash,
            roundId: record.roundId,
            recipient: record.recipient,
            amount: record.amount,
            token: record.token,
            timestamp: record.timestamp,
            status: record.status,
          });
        }
      }
    }

    // Advance the in-memory cursor and emit SSE only after a successful commit.
    if (nextCursor) {
      cursor = nextCursor;
      startLedger = null;
    }
    if (batchLastProcessedLedger > (lastProcessedLedger ?? 0)) {
      lastProcessedLedger = batchLastProcessedLedger;
    }
    recordPollSuccess();
  } catch (error) {
    recordPollFailure(error);
  } finally {
    isPolling = false;
  }
}
