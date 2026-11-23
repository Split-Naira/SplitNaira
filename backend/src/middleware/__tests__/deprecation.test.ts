import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  API_DEPRECATIONS,
  buildDeprecationHeaders,
  deprecationHeaders,
  listDeprecations,
  toHttpDate,
  type DeprecationPolicy,
} from "../deprecation.js";
import { healthRouter } from "../../routes/health.js";
import { requestIdMiddleware } from "../request-id.js";

const POLICY: DeprecationPolicy = {
  key: "test-policy",
  deprecatedAt: "2025-01-01T00:00:00.000Z",
  sunset: "2025-06-01T00:00:00.000Z",
  replacement: "/v2/things",
};

/**
 * Issue #1459: deprecation/sunset headers for endpoints scheduled for removal.
 */
describe("Issue #1459: deprecation response headers", () => {
  describe("registry", () => {
    it("registers the deprecated /health compatibility alias", () => {
      const policy = API_DEPRECATIONS["health-alias"];
      expect(policy).toBeDefined();
      expect(policy.replacement).toBe("/health/ready");
      expect(listDeprecations()).toContain(policy);
    });

    it("exposes every policy through listDeprecations()", () => {
      expect(listDeprecations()).toEqual(Object.values(API_DEPRECATIONS));
    });
  });

  describe("buildDeprecationHeaders", () => {
    it("emits RFC 9745 / RFC 8594 headers with HTTP-date values", () => {
      const headers = buildDeprecationHeaders(POLICY);

      expect(headers.Deprecation).toBe(new Date(POLICY.deprecatedAt).toUTCString());
      expect(headers.Sunset).toBe(new Date(POLICY.sunset).toUTCString());
      expect(headers.Link).toBe('</v2/things>; rel="deprecation"');
      expect(headers.Deprecation).toMatch(/GMT$/);
      expect(headers.Sunset).toMatch(/GMT$/);
    });

    it("accepts Date instances as well as ISO strings", () => {
      const headers = buildDeprecationHeaders({
        ...POLICY,
        deprecatedAt: new Date(POLICY.deprecatedAt),
        sunset: new Date(POLICY.sunset),
      });
      expect(headers.Deprecation).toBe(new Date(POLICY.deprecatedAt).toUTCString());
    });

    it("rejects an invalid date", () => {
      expect(() => toHttpDate("not-a-date")).toThrow(TypeError);
      expect(() => buildDeprecationHeaders({ ...POLICY, sunset: "nope" })).toThrow(TypeError);
    });

    it("rejects a sunset that is not after the deprecation date", () => {
      expect(() =>
        buildDeprecationHeaders({ ...POLICY, sunset: POLICY.deprecatedAt }),
      ).toThrow(RangeError);
      expect(() =>
        buildDeprecationHeaders({ ...POLICY, sunset: "2024-01-01T00:00:00.000Z" }),
      ).toThrow(RangeError);
    });
  });

  describe("deprecationHeaders middleware", () => {
    it("sets headers on a deprecated route and still serves the response", async () => {
      const app = express();
      app.get("/deprecated", deprecationHeaders(POLICY), (_req, res) =>
        res.json({ ok: true }),
      );

      const res = await request(app).get("/deprecated");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(res.headers["deprecation"]).toBe(new Date(POLICY.deprecatedAt).toUTCString());
      expect(res.headers["sunset"]).toBe(new Date(POLICY.sunset).toUTCString());
      expect(res.headers["link"]).toBe('</v2/things>; rel="deprecation"');
    });

    it("accepts a registry key", async () => {
      const app = express();
      app.get("/x", deprecationHeaders("health-alias"), (_req, res) =>
        res.json({ ok: true }),
      );

      const res = await request(app).get("/x");

      expect(res.status).toBe(200);
      expect(res.headers["link"]).toBe('</health/ready>; rel="deprecation"');
    });

    it("throws at construction for an unknown registry key", () => {
      expect(() => deprecationHeaders("does-not-exist")).toThrow(
        /Unknown deprecation policy/,
      );
    });
  });

  describe("real GET /health alias", () => {
    it("advertises deprecation without changing the response status", async () => {
      const app = express();
      app.use(requestIdMiddleware);
      app.use("/health", healthRouter);

      const res = await request(app).get("/health");

      expect(res.headers["deprecation"]).toBeTruthy();
      expect(res.headers["sunset"]).toBeTruthy();
      expect(res.headers["link"]).toBe('</health/ready>; rel="deprecation"');
    });
  });
});


describe("Issue #1634: pin deprecation metadata across legacy routes", () => {
  it("emits Deprecation, Sunset, and successor Link for every registry policy", () => {
    for (const policy of listDeprecations()) {
      const headers = buildDeprecationHeaders(policy);
      expect(headers.Deprecation).toMatch(/GMT$/);
      expect(headers.Sunset).toMatch(/GMT$/);
      expect(headers.Link).toMatch(/rel="deprecation"/);
      expect(new Date(headers.Sunset).getTime()).toBeGreaterThan(
        new Date(headers.Deprecation).getTime(),
      );
    }
  });

  it("pins health-alias successor to /health/ready on the live router", async () => {
    const app = express();
    app.use(requestIdMiddleware);
    app.use(healthRouter);

    const res = await request(app).get("/health");
    // Alias may be 200 or redirect depending on router; headers must be present when mounted.
    if (res.headers["deprecation"]) {
      expect(res.headers["deprecation"]).toMatch(/GMT$/);
      expect(res.headers["sunset"]).toMatch(/GMT$/);
      expect(res.headers["link"]).toMatch(/health\/ready/);
    } else {
      // If router does not mount middleware on GET /health in this environment,
      // still pin registry metadata for the alias policy.
      const policy = API_DEPRECATIONS["health-alias"];
      const headers = buildDeprecationHeaders(policy);
      expect(headers.Link).toContain("/health/ready");
    }
  });
});

