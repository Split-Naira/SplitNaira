/**
 * Safe shutdown coverage for active SSE subscribers (Issue #1094).
 *
 * `graceful-shutdown.integration.test.ts` exercises the real SIGTERM path,
 * but only in CI with Postgres. These in-process tests cover the SSE side
 * of shutdown directly: every open stream on both routes is ended, its bus
 * listener and metrics are cleaned up, and new streams are refused once
 * shutdown has started.
 */
import http from "http";
import type { Socket } from "net";
import type { AddressInfo } from "net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { closeAllSseConnections, getActiveSseConnectionCount } from "../routes/events.js";
import { markShuttingDown, resetShuttingDown } from "../routes/health.js";
import { getSseEventBus, getSseEventName } from "../services/SseEventBus.js";
import { getEventBus, TRANSACTION_CONFIRMED } from "../services/EventBus.js";
import { getSseConnectionsActive, getSseDisconnectsTotal } from "../services/metrics.js";

let server: http.Server;
let baseUrl: string;
const openSockets = new Set<Socket>();

beforeAll(async () => {
  const { app } = await import("../index.js");

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const address = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });

    server.on("connection", (socket) => {
      openSockets.add(socket);
      socket.on("close", () => openSockets.delete(socket));
    });
  });
});

afterEach(() => {
  resetShuttingDown();
  closeAllSseConnections();
});

afterAll(async () => {
  openSockets.forEach((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

interface OpenStream {
  res: http.IncomingMessage;
  ended: Promise<void>;
}

function openStream(path: string): Promise<OpenStream> {
  return new Promise((resolve, reject) => {
    const req = http.get(`${baseUrl}${path}`, (res) => {
      res.on("data", () => {});
      const ended = new Promise<void>((done) => {
        res.on("end", done);
        res.on("close", done);
      });
      resolve({ res, ended });
    });
    req.on("error", reject);
  });
}

function getJson(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    http
      .get(`${baseUrl}${path}`, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }));
      })
      .on("error", reject);
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("SSE shutdown (Issue #1094)", () => {
  it("ends every open stream on both SSE routes", async () => {
    const baseline = getActiveSseConnectionCount();
    const queryStream = await openStream("/events?txHash=shutdown-query-tx");
    const pathStream = await openStream("/events/transactions/shutdown-path-tx");

    expect(queryStream.res.statusCode).toBe(200);
    expect(pathStream.res.statusCode).toBe(200);
    expect(getActiveSseConnectionCount()).toBe(baseline + 2);

    const closed = closeAllSseConnections();
    expect(closed).toBe(baseline + 2);

    // Both clients observe a server-initiated end rather than hanging.
    await Promise.all([queryStream.ended, pathStream.ended]);
    await waitFor(() => getActiveSseConnectionCount() === 0);
  });

  it("removes bus listeners so later events are not written to closed streams", async () => {
    const sseBus = getSseEventBus();
    const txBus = getEventBus();
    const eventName = getSseEventName("shutdown-listener-tx");
    const txListenersBefore = txBus.listenerCount(TRANSACTION_CONFIRMED);

    const a = await openStream("/events?txHash=shutdown-listener-tx");
    const b = await openStream("/events/transactions/shutdown-listener-tx");
    expect(sseBus.listenerCount(eventName)).toBe(1);
    expect(txBus.listenerCount(TRANSACTION_CONFIRMED)).toBe(txListenersBefore + 1);

    closeAllSseConnections();
    await Promise.all([a.ended, b.ended]);

    await waitFor(
      () =>
        sseBus.listenerCount(eventName) === 0 &&
        txBus.listenerCount(TRANSACTION_CONFIRMED) === txListenersBefore
    );

    // Publishing after shutdown must not throw (no write-after-end).
    expect(() => sseBus.emit(eventName, { status: "confirmed" })).not.toThrow();
    expect(() =>
      txBus.emit(TRANSACTION_CONFIRMED, { txHash: "shutdown-listener-tx" })
    ).not.toThrow();
  });

  it("records one disconnect per drained stream and returns the active gauge to baseline", async () => {
    const activeBefore = getSseConnectionsActive();
    const disconnectsBefore = getSseDisconnectsTotal();

    const a = await openStream("/events?txHash=shutdown-metrics-tx");
    const b = await openStream("/events/transactions/shutdown-metrics-tx");
    expect(getSseConnectionsActive()).toBe(activeBefore + 2);

    closeAllSseConnections();
    await Promise.all([a.ended, b.ended]);

    await waitFor(() => getSseConnectionsActive() === activeBefore);
    expect(getSseDisconnectsTotal()).toBe(disconnectsBefore + 2);
  });

  it("is a safe no-op when there are no active streams, including repeated calls", () => {
    expect(getActiveSseConnectionCount()).toBe(0);
    expect(closeAllSseConnections()).toBe(0);
    expect(closeAllSseConnections()).toBe(0);
  });

  it.each([["/events?txHash=shutdown-late-tx"], ["/events/transactions/shutdown-late-tx"]])(
    "refuses new streams on %s once shutdown has started",
    async (path) => {
      markShuttingDown();

      const { status, body } = await getJson(path);

      expect(status).toBe(503);
      expect(body.error).toBe("shutting_down");
      expect(typeof body.requestId).toBe("string");
      // Nothing was registered, so nothing is left for the force-exit timer.
      expect(getActiveSseConnectionCount()).toBe(0);
      expect(getSseEventBus().listenerCount(getSseEventName("shutdown-late-tx"))).toBe(0);
    }
  );
});
