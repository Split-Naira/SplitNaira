/**
 * Explicit 409 conflict coverage for Idempotency-Key payload mismatches (Issue #1093).
 *
 * `routes/splits.test.ts` covers the happy path and a single mismatch on
 * POST /splits. These tests pin down exactly what counts as a "different
 * payload", which 409 code wins when states overlap, the stable error
 * envelope, and that a conflict never disturbs the original stored result.
 */
import express, { type Request, type Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { idempotencyMiddleware } from "../idempotency.js";
import { requestIdMiddleware } from "../request-id.js";
import { errorHandler, notFoundHandler } from "../error.js";
import { IdempotencyStore } from "../../services/idempotency.js";
import { getIdempotencyConflictsTotal } from "../../services/metrics.js";

const KEY = "conflict-test-key";

let store: IdempotencyStore;
let handler: Mock<(req: Request, res: Response) => unknown>;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware);

  const route = (req: Request, res: Response) => handler(req, res);
  app.post("/items", idempotencyMiddleware(store), route);
  app.post("/items/:itemId", idempotencyMiddleware(store), route);
  app.post("/other", idempotencyMiddleware(store), route);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

function send(app: express.Express, path: string, body: unknown, key = KEY) {
  return request(app)
    .post(path)
    .set("Idempotency-Key", key)
    .send(body as object);
}

beforeEach(() => {
  store = new IdempotencyStore();
  handler = vi.fn((req: Request, res: Response) => {
    res.status(200).json({ echoed: req.body });
  });
});

describe("idempotency payload mismatch → 409 (Issue #1093)", () => {
  it("returns the stable 409 IDEMPOTENCY_KEY_CONFLICT envelope", async () => {
    const app = createApp();
    await send(app, "/items", { amount: 100 }).expect(200);

    const res = await send(app, "/items", { amount: 200 }).expect(409);

    expect(res.body).toEqual({
      error: "idempotency_key_conflict",
      code: "IDEMPOTENCY_KEY_CONFLICT",
      message: "Idempotency-Key was already used with a different request payload.",
      requestId: expect.any(String),
      details: {},
    });
    expect(res.headers["x-request-id"]).toBe(res.body.requestId);
    expect(res.headers["idempotency-replayed"]).toBeUndefined();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a changed scalar value", { a: 1, b: "x" }, { a: 2, b: "x" }],
    ["an added field", { a: 1 }, { a: 1, extra: true }],
    ["a removed field", { a: 1, b: 2 }, { a: 1 }],
    ["a changed nested value", { outer: { inner: [1, 2] } }, { outer: { inner: [1, 3] } }],
    ["reordered array elements", { list: [1, 2, 3] }, { list: [3, 2, 1] }],
    ["a type change with the same printed value", { n: 1 }, { n: "1" }],
    ["null vs missing", { a: 1, b: null }, { a: 1 }],
    ["an empty body vs a populated body", {}, { a: 1 }],
  ])("treats %s as a mismatch", async (_label, first, second) => {
    const app = createApp();
    await send(app, "/items", first).expect(200);

    const res = await send(app, "/items", second).expect(409);

    expect(res.body.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not treat reordered object keys as a mismatch", async () => {
    const app = createApp();
    const first = await send(app, "/items", { a: 1, nested: { x: 1, y: 2 } }).expect(200);

    const replay = await send(app, "/items", { nested: { y: 2, x: 1 }, a: 1 }).expect(200);

    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(replay.body).toEqual(first.body);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("treats a different path param on the same route as a mismatch", async () => {
    const app = createApp();
    await send(app, "/items/one", { amount: 1 }).expect(200);

    const res = await send(app, "/items/two", { amount: 1 }).expect(409);

    expect(res.body.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
  });

  it("treats a different query string on the same route as a mismatch", async () => {
    const app = createApp();
    await send(app, "/items?mode=a", { amount: 1 }).expect(200);

    const res = await send(app, "/items?mode=b", { amount: 1 }).expect(409);

    expect(res.body.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
  });

  it("does not conflict when the same key is reused on a different route", async () => {
    const app = createApp();
    await send(app, "/items", { amount: 1 }).expect(200);

    const res = await send(app, "/other", { amount: 2 }).expect(200);

    expect(res.headers["idempotency-replayed"]).toBeUndefined();
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("keeps replaying the original response after a conflicting attempt", async () => {
    const app = createApp();
    const original = await send(app, "/items", { amount: 100 }).expect(200);

    await send(app, "/items", { amount: 999 }).expect(409);
    await send(app, "/items", { amount: 999 }).expect(409);

    const replay = await send(app, "/items", { amount: 100 }).expect(200);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(replay.body).toEqual(original.body);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("reports a payload mismatch rather than in-progress while the original is still running", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    handler = vi.fn(async (req: Request, res: Response) => {
      await gate;
      res.status(200).json({ echoed: req.body });
    });
    const app = createApp();

    const first = send(app, "/items", { amount: 1 }).then((r) => r);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));

    const mismatch = await send(app, "/items", { amount: 2 }).expect(409);
    const sameWhileRunning = await send(app, "/items", { amount: 1 }).expect(409);

    expect(mismatch.body.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
    expect(sameWhileRunning.body.code).toBe("IDEMPOTENCY_KEY_IN_PROGRESS");

    release();
    expect((await first).status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not hold the key after a non-2xx original, so a different payload can proceed", async () => {
    handler = vi.fn((req: Request, res: Response) => {
      if (req.body.amount < 0) {
        res.status(400).json({ error: "validation_error" });
        return;
      }
      res.status(200).json({ echoed: req.body });
    });
    const app = createApp();

    await send(app, "/items", { amount: -1 }).expect(400);
    const res = await send(app, "/items", { amount: 5 }).expect(200);

    expect(res.headers["idempotency-replayed"]).toBeUndefined();
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("increments the idempotency conflict metric once per 409", async () => {
    const app = createApp();
    await send(app, "/items", { amount: 1 }).expect(200);
    const before = getIdempotencyConflictsTotal();

    await send(app, "/items", { amount: 2 }).expect(409);
    await send(app, "/items", { amount: 3 }).expect(409);

    expect(getIdempotencyConflictsTotal()).toBe(before + 2);
  });
});
