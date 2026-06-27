import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { requestIdMiddleware } from "../middleware/request-id.js";
import { enrichLogEntry } from "../services/logger.js";
import { getRequestId, requestContext } from "../services/request-context.js";

describe("Request context propagation", () => {
  it("propagates requestId through AsyncLocalStorage during HTTP handling", async () => {
    const observed: string[] = [];
    const app = express();
    app.use(requestIdMiddleware);
    app.get("/test", (_req, res) => {
      observed.push(getRequestId() ?? "");
      enrichLogEntry({ level: "info", message: "nested service call" });
      observed.push(String(getRequestId()));
      res.json({ ok: true });
    });

    await request(app)
      .get("/test")
      .set("x-request-id", "integration-trace-id")
      .expect(200);

    expect(observed).toEqual(["integration-trace-id", "integration-trace-id"]);
  });

  it("automatically enriches log entries with requestId from context", () => {
    requestContext.run({ requestId: "log-correlation-id" }, () => {
      const entry = enrichLogEntry({ level: "info", message: "service log" });
      expect(entry.requestId).toBe("log-correlation-id");
    });
  });

  it("does not overwrite an explicitly provided requestId on log entries", () => {
    requestContext.run({ requestId: "context-id" }, () => {
      const entry = enrichLogEntry({
        level: "info",
        message: "explicit",
        requestId: "explicit-id"
      });
      expect(entry.requestId).toBe("explicit-id");
    });
  });

  it("generates a requestId when none is provided", async () => {
    let observedId: string | undefined;
    const app = express();
    app.use(requestIdMiddleware);
    app.get("/test", (_req, res) => {
      observedId = getRequestId();
      res.json({ ok: true });
    });

    const res = await request(app).get("/test").expect(200);

    expect(observedId).toBeTruthy();
    expect(res.headers["x-request-id"]).toBe(observedId);
  });
});
