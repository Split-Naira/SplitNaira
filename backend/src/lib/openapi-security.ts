/**
 * Issue #1635: keep the OpenAPI `security` declarations honest.
 *
 * The spec is generated from a registry that is completely separate from the
 * Express routers, so nothing stops a protected route from being documented as
 * public (or vice versa). This module derives the real guard set from the
 * mounted router middleware and compares it with the generated document.
 *
 * The comparison is intentionally small and structural rather than depending
 * on Express internals beyond `router.stack`, which both Express 4 and 5
 * expose with `route.path`, `route.methods` and the route handler names.
 */

export interface RouteHandlerLike {
  name?: string;
}

export interface RouteLayerLike {
  name?: string;
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: RouteHandlerLike[];
  };
}

export interface RouterLike {
  stack: RouteLayerLike[];
}

export interface MountedRouter {
  /** Absolute mount path, e.g. `/splits`. */
  prefix: string;
  router: RouterLike;
}

export interface OpenApiOperationLike {
  security?: Array<Record<string, unknown>>;
}

export interface OpenApiSpecLike {
  paths?: Record<string, Record<string, OpenApiOperationLike | undefined>>;
}

export interface SecurityMismatch {
  method: string;
  path: string;
  reason:
    | "protected_route_not_documented"
    | "declared_on_unprotected_route"
    | "security_mismatch";
  /** Schemes implied by the route middleware. */
  expected: string[];
  /** Schemes declared by the OpenAPI operation. */
  declared: string[];
}

/** Middleware names that require a bearer JWT in `Authorization`. */
const BEARER_GUARD_NAMES = new Set(["authJwtMiddleware"]);

/** Middleware names that require the payments admin API key. */
const ADMIN_GUARD_NAMES = new Set([
  "requirePaymentsAdminAccess",
  "enforcePaymentsAdminWriteEnabled",
]);

/** The app mounts the admin guard once at this prefix (see src/index.ts). */
const ADMIN_MOUNT_PREFIX = "/splits/admin";

function normalizePath(value: string): string {
  // Express route params (`:projectId`) map to OpenAPI path params
  // (`{projectId}`). Collapse duplicate slashes and drop a trailing slash so
  // `/splits/` and `/splits` compare equal, but keep the root path as `/`.
  const joined = value.replace(/\/+/g, "/");
  const trimmed = joined.length > 1 ? joined.replace(/\/$/, "") : joined;
  return trimmed.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function compareKey(method: string, path: string): string {
  return `${method.toLowerCase()} ${path}`;
}

function schemesFromSecurity(
  security: OpenApiOperationLike["security"],
): string[] {
  if (!security || security.length === 0) return [];
  return [...new Set(security.flatMap((requirement) => Object.keys(requirement)))].sort();
}

function securityFromMiddlewareNames(names: string[], fullPath: string): string[] {
  const schemes = new Set<string>();

  if (
    fullPath === ADMIN_MOUNT_PREFIX ||
    fullPath.startsWith(`${ADMIN_MOUNT_PREFIX}/`)
  ) {
    schemes.add("adminApiKey");
  }
  if (names.some((name) => ADMIN_GUARD_NAMES.has(name))) {
    schemes.add("adminApiKey");
  }
  if (names.some((name) => BEARER_GUARD_NAMES.has(name))) {
    schemes.add("bearerAuth");
  }

  return [...schemes].sort();
}

/**
 * Walks every mounted router and returns the security schemes implied by its
 * middleware, keyed by `"<method> <openapi-path>"`.
 *
 * Router-level `router.use(...)` middleware is applied to the routes declared
 * after it, matching Express's registration-order semantics, so a guard added
 * at the router level is attributed to the routes it actually protects.
 */
export function collectRouteSecurity(
  mountedRouters: MountedRouter[],
): Map<string, string[]> {
  const routes = new Map<string, string[]>();

  for (const { prefix, router } of mountedRouters) {
    const activeRouterMiddleware: string[] = [];

    for (const layer of router.stack ?? []) {
      if (!layer.route) {
        if (layer.name && layer.name !== "router") {
          activeRouterMiddleware.push(layer.name);
        }
        continue;
      }

      const routePath = normalizePath(
        normalizePath(prefix) === "/"
          ? layer.route.path
          : `${normalizePath(prefix)}${layer.route.path === "/" ? "" : layer.route.path}`,
      );
      const handlerNames = [
        ...activeRouterMiddleware,
        ...layer.route.stack.map((handler) => handler.name ?? "<anonymous>"),
      ];

      const schemes = securityFromMiddlewareNames(handlerNames, routePath);
      for (const method of Object.keys(layer.route.methods)) {
        routes.set(compareKey(method, routePath), schemes);
      }
    }
  }

  return routes;
}

/**
 * Compares the security implied by route middleware with the generated
 * OpenAPI document.
 *
 * Public routes may be undocumented (for example `/metrics` and the Swagger
 * UI); only protected routes and declared schemes are part of this contract.
 */
export interface SecurityVerificationOptions {
  /**
   * Also report protected routes that are absent from the document. Off by
   * default because not every protected router is part of the published API
   * surface yet (for example `/notifications`).
   */
  requireDocumentedProtectedRoutes?: boolean;
}

export function findOpenApiSecurityMismatches(
  spec: OpenApiSpecLike,
  routeSecurity: Map<string, string[]>,
  options: SecurityVerificationOptions = {},
): SecurityMismatch[] {
  const mismatches: SecurityMismatch[] = [];
  const documentedKeys = new Set<string>();

  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      if (!operation || typeof operation !== "object") continue;

      const key = compareKey(method, normalizePath(path));
      documentedKeys.add(key);

      const declared = schemesFromSecurity(operation.security);
      const expected = routeSecurity.get(key);

      if (!expected) {
        if (declared.length > 0) {
          mismatches.push({
            method: method.toUpperCase(),
            path,
            reason: "declared_on_unprotected_route",
            expected: [],
            declared,
          });
        }
        continue;
      }

      if (expected.length === 0 && declared.length > 0) {
        mismatches.push({
          method: method.toUpperCase(),
          path,
          reason: "declared_on_unprotected_route",
          expected,
          declared,
        });
        continue;
      }

      if (
        expected.length !== declared.length ||
        expected.some((scheme, index) => scheme !== declared[index])
      ) {
        mismatches.push({
          method: method.toUpperCase(),
          path,
          reason: "security_mismatch",
          expected,
          declared,
        });
      }
    }
  }

  if (options.requireDocumentedProtectedRoutes) {
    for (const [key, expected] of routeSecurity) {
      if (expected.length === 0 || documentedKeys.has(key)) continue;
      const [method, path] = key.split(" ", 2);
      mismatches.push({
        method: method.toUpperCase(),
        path,
        reason: "protected_route_not_documented",
        expected,
        declared: [],
      });
    }
  }

  return mismatches;
}

/** Formats mismatches for an assertion message that names every offender. */
export function formatSecurityMismatches(mismatches: SecurityMismatch[]): string {
  return mismatches
    .map(
      (mismatch) =>
        `${mismatch.method} ${mismatch.path}: ${mismatch.reason} ` +
        `(middleware=[${mismatch.expected.join(", ")}], ` +
        `OpenAPI=[${mismatch.declared.join(", ")}])`,
    )
    .join("\n");
}
