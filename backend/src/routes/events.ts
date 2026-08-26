import { Router, Request, Response } from "express";
import { getSseEventBus, getSseEventName } from "../services/SseEventBus.js";
import { getEventBus, TRANSACTION_CONFIRMED } from "../services/EventBus.js";
import { logger } from "../services/logger.js";
import { AppError, ErrorCode, ErrorType } from "../lib/errors.js";

// Heartbeat cadence for the path-based transaction stream. A comment line every
// 15s keeps intermediary proxies from closing an otherwise-idle connection.
const HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * Streaming Routes Note (Issue #524/Admin API response validation):
 *
 * All SSE endpoints in this router (`GET /events`, `GET /events/transactions/:txHash`)
 * maintain long-lived persistent HTTP connections using chunked `text/event-stream`
 * transfers rather than single-object JSON envelopes. Consequently, these streaming routes
 * are intentionally unvalidated by the `withResponseValidation` middleware.
 * Payload schemas within individual stream events are validated at the domain event layer.
 */
export const eventsRouter = Router();

function createSseHeaders(res: Response) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
}

function sendSseEvent(res: Response, type: string, data: unknown) {
  res.write(`event: ${type}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

interface EventSubscription {
  txHash: string;
  listener: (payload: unknown) => void;
  cleanup: () => void;
}

const parsedMaxListeners = Number(process.env.SSE_MAX_LISTENERS_PER_TXHASH ?? "5");
const MAX_LISTENERS_PER_TXHASH = Number.isNaN(parsedMaxListeners)
  ? 5
  : Math.max(1, parsedMaxListeners);
const activeSubscriptions = new Map<string, Set<EventSubscription>>();

// Tracks every open SSE response (both /events and /events/transactions/:txHash)
// so a graceful shutdown can proactively end them instead of waiting on
// server.close() to hang until each client disconnects on its own.
const activeSseResponses = new Set<Response>();

/** Ends every open SSE connection. Called from the SIGTERM/SIGINT handler. */
export function closeAllSseConnections(): void {
  for (const res of activeSseResponses) {
    try {
      res.end();
    } catch (error) {
      logger.warn("Failed to close SSE connection during shutdown", { error });
    }
  }
}

function getSubscriptionCount(txHash: string) {
  return activeSubscriptions.get(txHash)?.size ?? 0;
}

function addSubscription(subscription: EventSubscription) {
  const set = activeSubscriptions.get(subscription.txHash) ?? new Set();
  set.add(subscription);
  activeSubscriptions.set(subscription.txHash, set);
}

function removeSubscription(subscription: EventSubscription) {
  const set = activeSubscriptions.get(subscription.txHash);
  if (!set) return;
  set.delete(subscription);
  if (set.size === 0) {
    activeSubscriptions.delete(subscription.txHash);
  }
}

async function handleEventStream(req: Request, res: Response) {
  const txHash = String(req.query.txHash ?? "").trim();
  const requestId = res.locals.requestId as string | undefined;

  if (!txHash) {
    throw new AppError(
      ErrorType.VALIDATION,
      ErrorCode.VALIDATION_ERROR,
      "Query parameter txHash is required for /events SSE subscriptions."
    );
  }

  const currentCount = getSubscriptionCount(txHash);
  if (currentCount >= MAX_LISTENERS_PER_TXHASH) {
    res.status(429).json({
      error: "too_many_event_listeners",
      code: ErrorCode.RESOURCE_LIMIT_EXCEEDED,
      message: "Too many event stream subscribers for this transaction.",
      requestId,
      details: { txHash, limit: MAX_LISTENERS_PER_TXHASH },
    });
    return;
  }

  createSseHeaders(res);

  const eventBus = getSseEventBus();
  const eventName = getSseEventName(txHash);

  const subscription: EventSubscription = {
    txHash,
    listener(payload) {
      try {
        sendSseEvent(res, "transaction_update", payload);
      } catch (writeError) {
        logger.warn("Failed to send SSE payload", { txHash, requestId, error: writeError });
      }
    },
    cleanup() {
      eventBus.removeListener(eventName, subscription.listener);
      removeSubscription(subscription);
    },
  };

  addSubscription(subscription);
  activeSseResponses.add(res);
  eventBus.on(eventName, subscription.listener);

  res.on("close", () => {
    subscription.cleanup();
    activeSseResponses.delete(res);
    logger.info("SSE client disconnected", { txHash, requestId });
  });

  // Keep connection alive with periodic comments to prevent proxies from timing out
  const keepAlive = setInterval(() => {
    res.write(": keep-alive\n\n");
  }, 25_000);

  res.on("close", () => {
    clearInterval(keepAlive);
  });

  logger.info("SSE subscription opened", { txHash, requestId, currentCount: currentCount + 1 });
}

/**
 * SSE endpoint (Issue #618): GET /events/transactions/:txHash
 *
 * Holds the response open and streams the matching `transaction:confirmed`
 * event (emitted by EventListenerService once the record is saved) as a JSON
 * SSE message. The bus listener is removed and the heartbeat cleared when the
 * client disconnects.
 *
 * Reconnect assumptions for frontend clients:
 *  - the stream is live-only (no replay/catch-up on reconnect),
 *  - clients should reconnect and continue polling status until terminal state.
 */
function handleTransactionStream(req: Request, res: Response) {
  const txHash = String(req.params.txHash ?? "").trim();
  const requestId = res.locals.requestId as string | undefined;

  if (!txHash) {
    throw new AppError(
      ErrorType.VALIDATION,
      ErrorCode.VALIDATION_ERROR,
      "Path parameter txHash is required for /events/transactions subscriptions."
    );
  }

  createSseHeaders(res);

  const bus = getEventBus();
  const listener = (record: unknown) => {
    if (
      record &&
      typeof record === "object" &&
      (record as { txHash?: unknown }).txHash === txHash
    ) {
      try {
        sendSseEvent(res, "transaction:confirmed", record);
      } catch (writeError) {
        logger.warn("Failed to send transaction SSE payload", {
          txHash,
          requestId,
          error: writeError,
        });
      }
    }
  };

  bus.on(TRANSACTION_CONFIRMED, listener);
  activeSseResponses.add(res);

  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, HEARTBEAT_INTERVAL_MS);

  req.on("close", () => {
    bus.removeListener(TRANSACTION_CONFIRMED, listener);
    clearInterval(heartbeat);
    activeSseResponses.delete(res);
    logger.info("Transaction SSE client disconnected", { txHash, requestId });
  });

  logger.info("Transaction SSE subscription opened", { txHash, requestId });
}

eventsRouter.get("/", handleEventStream);
eventsRouter.get("/transactions/:txHash", handleTransactionStream);
