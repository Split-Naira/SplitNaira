import { EventEmitter } from "events";

const SSE_EVENT_PREFIX = "tx:";

const eventBus = new EventEmitter();
eventBus.setMaxListeners(0);

export function getSseEventBus() {
  return eventBus;
}

export function getSseEventName(txHash: string) {
  return `${SSE_EVENT_PREFIX}${txHash}`;
}

export function publishSseEvent(txHash: string, payload: unknown) {
  eventBus.emit(getSseEventName(txHash), payload);
}
