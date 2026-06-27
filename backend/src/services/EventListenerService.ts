import { getStellarRpcServer, loadStellarConfig, executeWithRetry } from "./stellar.js";
import { getDataSource } from "./database.js";
import { TransactionRecord } from "../entities/Transaction.js";
import { ServiceState } from "../entities/ServiceState.js";
import { logger } from "./logger.js";
import { scValToNative } from "@stellar/stellar-sdk";
import { fetchProjectById } from "./splits.service.js";
import { publishSseEvent } from "./SseEventBus.js";

/** ServiceState key under which the latest processed event cursor is persisted. */
const EVENT_LISTENER_CURSOR_KEY = "event_listener_cursor";

let pollInterval: NodeJS.Timeout | null = null;
let isPolling = false;
let startLedger: number | null = null;
let cursor: string | null = null;

export async function startEventListenerService() {
  if (pollInterval) {
    logger.warn("EventListenerService is already running");
    return;
  }

  logger.info("Starting EventListenerService background worker...");

  try {
    // Restart-safe resume: prefer the cursor persisted from the last run so we
    // don't miss events that occurred while the server was down (Issue #619).
    const dataSource = getDataSource();
    const persisted = await dataSource
      .getRepository(ServiceState)
      .findOneBy({ key: EVENT_LISTENER_CURSOR_KEY });

    if (persisted?.value) {
      cursor = persisted.value;
      startLedger = null;
      logger.info("Resuming EventListenerService from persisted event cursor.");
    } else {
      // First run (no persisted cursor): start 100 ledgers back to cover a
      // short startup gap.
      const server = getStellarRpcServer();
      const latestLedger = await executeWithRetry(() => server.getLatestLedger());
      startLedger = Math.max(1, latestLedger.sequence - 100);
      logger.info(
        `Initialized EventListenerService to start polling from ledger: ${startLedger}`
      );
    }
  } catch (error) {
    logger.error(
      "Failed to determine EventListenerService start position. Polling from latest.",
      { error }
    );
  }

  pollInterval = setInterval(() => {
    void pollEvents();
  }, 5000);
}

export function stopEventListenerService() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    logger.info("EventListenerService background worker stopped cleanly.");
  }
}

export function getServiceHealth() {
  return {
    running: pollInterval !== null,
    isPolling,
    cursor,
  };
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

    const response = await executeWithRetry(() =>
      server.getEvents(filterOptions)
    );

    const newRecords: TransactionRecord[] = [];
    const ssePayloads: Array<{
      txHash: string;
      roundId: string;
      recipient: string;
      amount: string;
      token: string;
      timestamp: number;
      status: "completed";
    }> = [];

    for (const event of response?.events ?? []) {
      try {
        const topics = event.topic.map((topic) => {
          try {
            return String(scValToNative(topic));
          } catch {
            return "";
          }
        });

        // Only index `payment_sent` events.
        if (topics[0] !== "payment_sent") {
          continue;
        }

        const projectId = topics[1] || "";
        const valueData = scValToNative(event.value) as [string, string | number | bigint];
        const recipient = valueData[0];
        const amount = String(valueData[1]);
        const txHash = event.txHash;
        const timestamp = Math.floor(new Date(event.ledgerClosedAt).getTime() / 1000);

        // Skip already-indexed transactions. The unique index on `txHash` plus
        // the upsert below are the source of truth; this check just avoids
        // redundant work and duplicate SSE emissions.
        const existing = await repo.findOneBy({ txHash });
        if (existing) {
          continue;
        }

        // Resolve the project's token address (best-effort; falls back to Native).
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
        ssePayloads.push({
          txHash,
          roundId: projectId,
          recipient,
          amount,
          token,
          timestamp,
          status: "completed",
        });
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
    if (newRecords.length > 0 || (nextCursor && nextCursor !== cursor)) {
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
      });

      if (newRecords.length > 0) {
        logger.info(
          `Upserted ${newRecords.length} transaction record(s) from current event batch.`
        );
      }
    }

    // Advance the in-memory cursor and emit SSE only after a successful commit.
    if (nextCursor) {
      cursor = nextCursor;
      startLedger = null;
    }
    for (const payload of ssePayloads) {
      publishSseEvent(payload.txHash, payload);
    }
  } catch (error) {
    logger.error("Error occurred in background Soroban event poll", {
      error,
    });
  } finally {
    isPolling = false;
  }
}