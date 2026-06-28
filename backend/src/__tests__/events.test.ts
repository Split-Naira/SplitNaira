import http from "http";
import type { Socket } from "net";
import { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let server: http.Server;
let baseUrl: string;
const openSockets = new Set<Socket>();

beforeAll(async () => {
  process.env.SSE_MAX_LISTENERS_PER_TXHASH = "1";

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

afterAll(async () => {
  openSockets.forEach((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
});

function openSseConnection(path: string): Promise<{ res: http.IncomingMessage; req: http.ClientRequest }> {
  return new Promise((resolve, reject) => {
    const req = http.get(`${baseUrl}${path}`, (res) => {
      resolve({ res, req });
    });

    req.on("error", reject);
  });
}

describe("SSE /events route", () => {
  it("should open an SSE connection with the correct headers", async () => {
    const { res, req } = await openSseConnection("/events?txHash=test-tx-hash");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
    expect(res.headers["cache-control"]).toContain("no-cache");
    req.destroy();
  });

  it("should reject excessive subscriptions for the same txHash", async () => {
    const first = await openSseConnection("/events?txHash=throttle-tx-hash");
    expect(first.res.statusCode).toBe(200);

    const secondResponse = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const req = http.get(`${baseUrl}/events?txHash=throttle-tx-hash`, (res) => {
        resolve(res);
      });
      req.on("error", reject);
    });

    expect(secondResponse.statusCode).toBe(429);
    first.req.destroy();
  });
});
