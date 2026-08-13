import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { writeLimiter } from "../rate-limit.js";

function makeApp() {
  const app = express();

  app.use((req, res, next) => {
    res.locals.requestId = req.header("x-request-id") ?? "test-request-id";
    next();
  });

  app.use("/api/protected", writeLimiter);
  app.get("/api/protected", (_req, res) => {
    res.status(200).json({ success: true });
  });

  return app;
}

describe("rate-limit middleware", () => {
  it("returns standard headers and the active 429 API error shape", async () => {
    const app = makeApp();
    const requestId = "rate-limit-test-request";

    const firstResponse = await request(app).get("/api/protected").set("x-request-id", requestId);
    expect(firstResponse.status).toBe(200);
    expect(firstResponse.headers).toHaveProperty("ratelimit-limit");
    expect(firstResponse.headers).toHaveProperty("ratelimit-remaining");

    const limit = Number.parseInt(String(firstResponse.headers["ratelimit-limit"]), 10);
    expect(limit).toBeGreaterThan(0);

    for (let i = 1; i < limit; i += 1) {
      await request(app).get("/api/protected").set("x-request-id", requestId);
    }

    const limitedResponse = await request(app).get("/api/protected").set("x-request-id", requestId);

    expect(limitedResponse.status).toBe(429);
    expect(limitedResponse.headers).toHaveProperty("retry-after");
    expect(limitedResponse.body).toMatchObject({
      error: "rate_limited",
      code: "RATE_LIMITED",
      requestId
    });
  });
});
