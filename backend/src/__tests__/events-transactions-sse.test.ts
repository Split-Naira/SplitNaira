/**
 * SSE transaction stream integration tests (Issue #618)
 *
 * Verifies GET /events/transactions/:txHash:
 *  - a subscriber receives a JSON event when the matching transaction is
 *    confirmed (emitted on the shared EventBus),
 *  - non-matching transactions are not delivered,
 *  - the bus listener is cleaned up on client disconnect.
 *
 * Uses raw http (like events.test.ts) to avoid pulling in an EventSource
 * polyfill dependency; it exercises the same SSE contract a browser would.
 */

import http from "http";
import type { Socket } from "net";
import { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";

let server: http.Server;
let baseUrl: string;
const openSockets = new Set<Socket>();

let getEventBus: typeof import("../services/EventBus.js").getEventBus;
let TRANSACTION_CONFIRMED: typeof import("../services/EventBus.js").TRANSACTION_CONFIRMED;

beforeAll(async () => {
  const { eventsRouter } = await import("../routes/events.js");
  ({ getEventBus, TRANSACTION_CONFIRMED } = await import("../services/EventBus.js"));

  const app = express();
  app.use("/events", eventsRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
    server.on("connection", (socket) => {
      openSockets.add(socket);
      socket.on("close", () => openSockets.delete(socket));
    });
  });
});

afterAll(async () => {
  openSockets.forEach((socket) => socket.destroy());
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

/** Opens an SSE connection and resolves with the response + the request handle. */
function openStream(path: string): Promise<{ res: http.IncomingMessage; req: http.ClientRequest }> {
  return new Promise((resolve, reject) => {
    const req = http.get(`${baseUrl}${path}`, (res) => resolve({ res, req }));
    req.on("error", reject);
  });
}

/** Parses the `data:` line out of the first complete SSE message in a buffer. */
function parseFirstSseData(buffer: string): unknown | null {
  const match = buffer.match(/data: (.*)\n\n/);
  return match ? JSON.parse(match[1]) : null;
}

describe("GET /events/transactions/:txHash (SSE)", () => {
  it("opens an SSE stream with the correct headers", async () => {
    const { res, req } = await openStream("/events/transactions/tx-headers");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
    expect(res.headers["connection"]).toMatch(/keep-alive/i);
    req.destroy();
  });

  it("delivers a JSON event when the matching transaction is confirmed", async () => {
    const txHash = "tx-match-123";
    const record = {
      txHash,
      roundId: "proj-1",
      recipient: "GREC...",
      amount: "1000",
      token: "Native",
      timestamp: 1_700_000_000,
      status: "completed",
    };

    const { res, req } = await openStream(`/events/transactions/${txHash}`);

    const received = new Promise<unknown>((resolve) => {
      let buffer = "";
      res.on("data", (chunk) => {
        buffer += chunk.toString();
        const data = parseFirstSseData(buffer);
        if (data) resolve(data);
      });
    });

    // Give the route a tick to register its bus listener, then emit.
    await new Promise((r) => setTimeout(r, 50));
    getEventBus().emit(TRANSACTION_CONFIRMED, record);

    const data = (await received) as {
      txHash: string;
      roundId: string;
      recipient: string;
      amount: string;
      token: string;
      timestamp: number;
      status: string;
    };
    expect(data.txHash).toBe(txHash);
    expect(data.roundId).toBe("proj-1");
    expect(data.recipient).toBe("GREC...");
    expect(data.amount).toBe("1000");
    expect(data.token).toBe("Native");
    expect(data.timestamp).toBe(1_700_000_000);
    expect(data.status).toBe("completed");
    req.destroy();
  });

  it("sends heartbeat comments while the stream is idle", async () => {
    const { res, req } = await openStream("/events/transactions/tx-heartbeat");

    const gotHeartbeat = new Promise<void>((resolve) => {
      let buffer = "";
      res.on("data", (chunk) => {
        buffer += chunk.toString();
        if (buffer.includes(": heartbeat\n\n")) {
          resolve();
        }
      });
    });

    await gotHeartbeat;
    req.destroy();
  }, 20_000);

  it("does not deliver events for a different txHash", async () => {
    const { res, req } = await openStream("/events/transactions/tx-mine");

    let gotData = false;
    res.on("data", (chunk) => {
      if (/data: /.test(chunk.toString())) gotData = true;
    });

    await new Promise((r) => setTimeout(r, 50));
    getEventBus().emit(TRANSACTION_CONFIRMED, { txHash: "tx-someone-else" });
    await new Promise((r) => setTimeout(r, 150));

    expect(gotData).toBe(false);
    req.destroy();
  });

  it("does not replay events emitted before the client subscribes", async () => {
    const txHash = "tx-no-replay";
    getEventBus().emit(TRANSACTION_CONFIRMED, { txHash, status: "completed" });

    const { res, req } = await openStream(`/events/transactions/${txHash}`);
    let gotData = false;

    res.on("data", (chunk) => {
      if (/data: /.test(chunk.toString())) gotData = true;
    });

    await new Promise((r) => setTimeout(r, 200));
    expect(gotData).toBe(false);
    req.destroy();
  });

  it("allows reconnecting and receiving updates on the new stream", async () => {
    const txHash = "tx-reconnect";

    const first = await openStream(`/events/transactions/${txHash}`);
    first.req.destroy();
    await new Promise((r) => setTimeout(r, 100));

    const second = await openStream(`/events/transactions/${txHash}`);
    const received = new Promise<unknown>((resolve) => {
      let buffer = "";
      second.res.on("data", (chunk) => {
        buffer += chunk.toString();
        const data = parseFirstSseData(buffer);
        if (data) resolve(data);
      });
    });

    await new Promise((r) => setTimeout(r, 50));
    getEventBus().emit(TRANSACTION_CONFIRMED, { txHash, status: "completed" });

    const data = (await received) as { txHash: string; status: string };
    expect(data.txHash).toBe(txHash);
    expect(data.status).toBe("completed");
    second.req.destroy();
  });

  it("cleans up the bus listener on client disconnect", async () => {
    const bus = getEventBus();

    const { req } = await openStream("/events/transactions/tx-cleanup");
    await new Promise((r) => setTimeout(r, 50));
    // Count with this subscription active (relative to any other live streams).
    const connected = bus.listenerCount(TRANSACTION_CONFIRMED);

    req.destroy();
    // Allow the server to observe the closed connection.
    await new Promise((r) => setTimeout(r, 200));
    expect(bus.listenerCount(TRANSACTION_CONFIRMED)).toBe(connected - 1);
  });
});

describe("SSE connection metrics (#1166)", () => {
  it("increments sse_connections_active on connect and decrements + records a disconnect on close", async () => {
    const { getSseConnectionsActive, getSseDisconnectsTotal } = await import(
      "../services/metrics.js"
    );

    const activeBefore = getSseConnectionsActive();
    const disconnectsBefore = getSseDisconnectsTotal();

    const { req } = await openStream("/events/transactions/tx-metrics-1");
    await new Promise((r) => setTimeout(r, 50));

    expect(getSseConnectionsActive()).toBe(activeBefore + 1);
    expect(getSseDisconnectsTotal()).toBe(disconnectsBefore);

    req.destroy();
    await new Promise((r) => setTimeout(r, 200));

    expect(getSseConnectionsActive()).toBe(activeBefore);
    expect(getSseDisconnectsTotal()).toBe(disconnectsBefore + 1);
  });

  it("tracks metrics independently for the query-param /events stream too", async () => {
    const { getSseConnectionsActive, getSseDisconnectsTotal } = await import(
      "../services/metrics.js"
    );

    const activeBefore = getSseConnectionsActive();
    const disconnectsBefore = getSseDisconnectsTotal();

    const { req } = await openStream("/events?txHash=tx-metrics-2");
    await new Promise((r) => setTimeout(r, 50));

    expect(getSseConnectionsActive()).toBe(activeBefore + 1);

    req.destroy();
    await new Promise((r) => setTimeout(r, 200));

    expect(getSseConnectionsActive()).toBe(activeBefore);
    expect(getSseDisconnectsTotal()).toBe(disconnectsBefore + 1);
  });

  it("exposes both series on GET /metrics in Prometheus format", async () => {
    const { metricsRouter } = await import("../routes/metrics.js");
    const express = (await import("express")).default;
    const request = (await import("supertest")).default;

    const app = express();
    app.use("/metrics", metricsRouter);

    const res = await request(app).get("/metrics");
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/# TYPE sse_connections_active gauge/);
    expect(res.text).toMatch(/sse_connections_active \d+/);
    expect(res.text).toMatch(/# TYPE sse_disconnects_total counter/);
    expect(res.text).toMatch(/sse_disconnects_total \d+/);
  });
});
