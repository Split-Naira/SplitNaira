import { EventEmitter } from "events";

/**
 * Application-wide event bus (Issue #618).
 *
 * A single shared {@link EventEmitter} that backend services use to broadcast
 * named domain events to in-process consumers (e.g. the SSE routes). This is
 * deliberately transport-agnostic: producers emit, the SSE layer fans out to
 * connected clients.
 *
 * Named events:
 * - {@link TRANSACTION_CONFIRMED} — payload: a saved `TransactionRecord`.
 */

/** Emitted after a transaction record has been persisted. */
export const TRANSACTION_CONFIRMED = "transaction:confirmed";

const eventBus = new EventEmitter();
// SSE means one listener per connected client; there is no meaningful upper
// bound, so disable the default max-listeners warning.
eventBus.setMaxListeners(0);

/** Returns the process-wide singleton event bus. */
export function getEventBus(): EventEmitter {
  return eventBus;
}
