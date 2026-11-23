import { describe, expect, it } from "vitest";

import { generateOpenApi } from "../openapi.js";
import {
  collectRouteSecurity,
  findOpenApiSecurityMismatches,
  formatSecurityMismatches,
  type MountedRouter,
  type OpenApiSpecLike,
  type RouterLike,
} from "../lib/openapi-security.js";
import { healthRouter } from "../routes/health.js";
import { splitsRouter } from "../routes/splits.js";
import { opsRouter } from "../routes/ops.js";
import { usersRouter } from "../routes/users.js";
import { transactionsRouter } from "../routes/transactions.js";
import { eventsRouter } from "../routes/events.js";
import { notificationsRouter } from "../routes/notifications.js";
import { authEmailRouter } from "../routes/auth-email.js";
import { authAccountRouter } from "../routes/auth-account.js";
import { collaborationRouter } from "../routes/collaboration.js";
import { ledgerRouter } from "../routes/ledger.js";

/**
 * Mirrors the `app.use(...)` mounts in src/index.ts. Keep this list in sync
 * when a router is mounted at a new prefix; otherwise its routes fall outside
 * the verification.
 */
const MOUNTED_ROUTERS: MountedRouter[] = [
  { prefix: "/health", router: healthRouter as unknown as RouterLike },
  { prefix: "/splits", router: splitsRouter as unknown as RouterLike },
  { prefix: "/ops", router: opsRouter as unknown as RouterLike },
  { prefix: "/auth", router: authEmailRouter as unknown as RouterLike },
  { prefix: "/auth", router: authAccountRouter as unknown as RouterLike },
  { prefix: "/collaboration", router: collaborationRouter as unknown as RouterLike },
  { prefix: "/users", router: usersRouter as unknown as RouterLike },
  { prefix: "/transactions", router: transactionsRouter as unknown as RouterLike },
  { prefix: "/events", router: eventsRouter as unknown as RouterLike },
  { prefix: "/api/ledger", router: ledgerRouter as unknown as RouterLike },
  { prefix: "/notifications", router: notificationsRouter as unknown as RouterLike },
];

describe("OpenAPI security declarations match route middleware (#1635)", () => {
  it("has no protected route documented without its guard, and no extra declared guard", () => {
    const routeSecurity = collectRouteSecurity(MOUNTED_ROUTERS);
    const mismatches = findOpenApiSecurityMismatches(
      generateOpenApi() as unknown as OpenApiSpecLike,
      routeSecurity,
    );

    expect(mismatches, formatSecurityMismatches(mismatches)).toEqual([]);
  });

  it("declares bearer auth on exactly the JWT-protected documented routes", () => {
    const routeSecurity = collectRouteSecurity(MOUNTED_ROUTERS);

    expect(routeSecurity.get("get /users/me")).toEqual(["bearerAuth"]);
    expect(routeSecurity.get("patch /users/me")).toEqual(["bearerAuth"]);
    expect(routeSecurity.get("delete /users/me")).toEqual(["bearerAuth"]);
    expect(routeSecurity.get("get /transactions/export")).toEqual(["bearerAuth"]);
    expect(routeSecurity.get("get /users/{walletAddress}")).toEqual([]);
  });

  it("applies the app-level payments admin guard to every /splits/admin route", () => {
    const routeSecurity = collectRouteSecurity(MOUNTED_ROUTERS);
    const adminRoutes = [...routeSecurity.entries()].filter(([key]) =>
      key.includes(" /splits/admin/"),
    );

    expect(adminRoutes.length).toBeGreaterThan(0);
    for (const [key, schemes] of adminRoutes) {
      expect(schemes, key).toEqual(["adminApiKey"]);
    }
  });
});

describe("security verification failure modes", () => {
  const bearerRoute: RouterLike = {
    stack: [
      {
        route: {
          path: "/me",
          methods: { get: true },
          stack: [{ name: "authJwtMiddleware" }, { name: "<anonymous>" }],
        },
      },
    ],
  };

  it("reports a protected route whose operation declares no security", () => {
    const routeSecurity = collectRouteSecurity([{ prefix: "/users", router: bearerRoute }]);
    const mismatches = findOpenApiSecurityMismatches(
      { paths: { "/users/me": { get: { security: [] } } } },
      routeSecurity,
    );

    expect(mismatches).toEqual([
      {
        method: "GET",
        path: "/users/me",
        reason: "security_mismatch",
        expected: ["bearerAuth"],
        declared: [],
      },
    ]);
  });

  it("reports a security declaration on a route with no guard middleware", () => {
    const publicRoute: RouterLike = {
      stack: [
        {
          route: {
            path: "/status",
            methods: { get: true },
            stack: [{ name: "handleStatus" }],
          },
        },
      ],
    };
    const routeSecurity = collectRouteSecurity([{ prefix: "/ops", router: publicRoute }]);
    const mismatches = findOpenApiSecurityMismatches(
      { paths: { "/ops/status": { get: { security: [{ adminApiKey: [] }] } } } },
      routeSecurity,
    );

    expect(mismatches).toEqual([
      {
        method: "GET",
        path: "/ops/status",
        reason: "declared_on_unprotected_route",
        expected: [],
        declared: ["adminApiKey"],
      },
    ]);
  });

  it("attributes router-level middleware to the routes registered after it", () => {
    const routerLevelAuth: RouterLike = {
      stack: [
        { name: "authJwtMiddleware" },
        {
          route: {
            path: "/",
            methods: { get: true },
            stack: [{ name: "<anonymous>" }],
          },
        },
      ],
    };

    expect(
      collectRouteSecurity([{ prefix: "/notifications", router: routerLevelAuth }]).get(
        "get /notifications",
      ),
    ).toEqual(["bearerAuth"]);
  });

  it("can require every protected route to be documented", () => {
    const routeSecurity = collectRouteSecurity([{ prefix: "/users", router: bearerRoute }]);
    const mismatches = findOpenApiSecurityMismatches(
      { paths: {} },
      routeSecurity,
      { requireDocumentedProtectedRoutes: true },
    );

    expect(mismatches).toEqual([
      {
        method: "GET",
        path: "/users/me",
        reason: "protected_route_not_documented",
        expected: ["bearerAuth"],
        declared: [],
      },
    ]);
  });

  it("normalizes Express params and treats absent security as public", () => {
    const paramRoute: RouterLike = {
      stack: [
        {
          route: {
            path: "/:projectId",
            methods: { get: true },
            stack: [{ name: "getProject" }],
          },
        },
      ],
    };
    const routeSecurity = collectRouteSecurity([{ prefix: "/splits", router: paramRoute }]);

    expect(routeSecurity.get("get /splits/{projectId}")).toEqual([]);
    expect(
      findOpenApiSecurityMismatches(
        { paths: { "/splits/{projectId}": { get: {} } } },
        routeSecurity,
      ),
    ).toEqual([]);
  });
});
