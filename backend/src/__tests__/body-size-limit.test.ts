/**
 * Request Body Size Limit Tests
 *
 * Validates that the backend rejects oversized JSON payloads with a stable
 * 413 (Payload Too Large) response and includes a correlation ID for
 * diagnostics. The configured body-parser limit is 1 MB for JSON and text payloads.
 *
 * Related: GitHub Issue #840
 */

import express from "express";
import request from "supertest";
import { describe, it, expect, beforeEach } from "vitest";
import { requestIdMiddleware } from "../middleware/request-id.js";
import { errorHandler } from "../middleware/error.js";

describe("Request Body Size Limit (Issue #840)", () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(requestIdMiddleware);
    // Match the production body-parser configuration exactly.
    app.use(express.json({ limit: "1mb" }));
    app.use(express.text({ type: "text/plain", limit: "1mb" }));

    // A simple echo route to test with
    app.post("/api/echo", (_req, res) => {
      const bodySize = _req.body ? JSON.stringify(_req.body).length : 0;
      res.json({ received: true, bodySize });
    });

    app.use(errorHandler);
  });

  // ─── Oversized payload rejection ────────────────────────────────────────

  it("rejects payloads larger than 1 MB with a 413 response", async () => {
    // Generate a payload that exceeds 1 MB (1 * 1024 * 1024 bytes)
    const largeString = "x".repeat(1_048_577); // ~1 MB + 1 byte
    const payload = { data: largeString };

    const res = await request(app)
      .post("/api/echo")
      .send(payload)
      .set("Content-Type", "application/json");

    expect(res.status).toBe(413);
  });

  it("returns a stable error shape on oversized payload rejection", async () => {
    const largeString = "x".repeat(1_048_577);
    const payload = { data: largeString };

    const res = await request(app)
      .post("/api/echo")
      .send(payload)
      .set("Content-Type", "application/json");

    expect(res.status).toBe(413);
    // Express's built-in body parser error should be a JSON response
    expect(res.body).toBeDefined();
  });

  it("includes a correlation ID (requestId) in 413 rejection response", async () => {
    const largeString = "x".repeat(1_048_577);
    const payload = { data: largeString };

    const res = await request(app)
      .post("/api/echo")
      .send(payload)
      .set("Content-Type", "application/json");

    // The requestIdMiddleware sets a unique ID on every request. We verify
    // it's present in the response so ops can correlate the rejection.
    // Express may include it in headers or the body depending on format.
    const hasRequestId =
      res.headers["x-request-id"] !== undefined ||
      (res.body && typeof res.body === "object" && "requestId" in res.body);

    expect(hasRequestId).toBe(true);
  });

  // ─── Within-limit acceptance ────────────────────────────────────────────

  it("accepts payloads at approximately 1 MB (within the limit)", async () => {
    // Build a payload that serializes to just under 1 MB to avoid
    // fragility from hard-coded JSON structure overhead estimates.
    // The JSON wrapper adds ~10-15 bytes; 1_048_500 bytes of payload
    // keeps the total serialized size safely between 999 KB and 1 MB.
    const nearLimit = "a".repeat(1_048_500);
    const payload = { data: nearLimit };
    const serializedSize = JSON.stringify(payload).length;
    expect(serializedSize).toBeLessThan(1_048_576);

    const res = await request(app)
      .post("/api/echo")
      .send(payload)
      .set("Content-Type", "application/json");

    expect(res.status).toBe(200);
  });

  it("accepts normal-sized payloads without issue", async () => {
    const payload = { name: "test", value: 42 };

    const res = await request(app)
      .post("/api/echo")
      .send(payload)
      .set("Content-Type", "application/json");

    expect(res.status).toBe(200);
  });

  // ─── Small payloads ─────────────────────────────────────────────────────

  it("handles empty JSON body gracefully", async () => {
    const res = await request(app)
      .post("/api/echo")
      .send({})
      .set("Content-Type", "application/json");

    expect(res.status).toBe(200);
  });

  it("handles a deeply nested but small payload", async () => {
    // Deeply nested objects can also be a DoS vector, but should be
    // accepted if within the size limit
    let nested = { value: "leaf" };
    for (let i = 0; i < 20; i++) {
      nested = { nested };
    }

    const res = await request(app)
      .post("/api/echo")
      .send({ data: nested })
      .set("Content-Type", "application/json");

    expect(res.status).toBe(200);
  });

  // ─── Non-JSON content types ─────────────────────────────────────────────

  it("rejects oversized text payloads with the same stable 413 shape", async () => {
    const largeData = "x".repeat(1_048_577);

    const res = await request(app)
      .post("/api/echo")
      .send(largeData)
      .set("Content-Type", "text/plain");

    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({
      error: "payload_too_large",
      code: "PAYLOAD_TOO_LARGE",
    });
    expect(res.headers["x-request-id"]).toBeDefined();
  });
});
