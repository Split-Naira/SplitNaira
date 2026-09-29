/**
 * Enforcement tests for the collaborator permissions matrix (#1300).
 *
 * The matrix itself is covered by `permissions-matrix.test.ts`. These tests
 * cover the part that was missing: resolving a requester's role from the
 * project's stored collaboration record, and refusing to use a role the caller
 * supplied about itself.
 */

import { describe, expect, it, vi } from "vitest";
import {
  assertProjectPermission,
  resolveRequesterRole,
  type ProjectRoleContext,
} from "../permissions.js";
import { createProjectPermissionMiddleware } from "../../../middleware/project-permission.js";

const OWNER = "GOWNER000000000000000000000000000000000000000000000000";
const ADMIN = "GADMIN000000000000000000000000000000000000000000000000";
const VIEWER = "GVIEWER00000000000000000000000000000000000000000000000";
const STRANGER = "GSTRANGER00000000000000000000000000000000000000000000";

function context(overrides: Partial<ProjectRoleContext> = {}): ProjectRoleContext {
  return {
    owner: OWNER,
    collaborators: [
      { address: ADMIN, role: "admin" },
      { address: VIEWER, role: "viewer" },
      { address: "GNOROLE0000000000000000000000000000000000000000000000" },
    ],
    ...overrides,
  };
}

/** Minimal express doubles — the middleware only touches these. */
function mockResponse() {
  return {
    locals: {} as Record<string, unknown>,
    statusCode: 0,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

function mockRequest(projectId?: string, body: unknown = {}) {
  return { params: projectId ? { projectId } : {}, body };
}

describe("resolveRequesterRole", () => {
  it("maps the project owner to the owner role", () => {
    expect(resolveRequesterRole(context(), OWNER)).toBe("owner");
  });

  it("honours the stored role of a listed collaborator", () => {
    expect(resolveRequesterRole(context(), ADMIN)).toBe("admin");
    expect(resolveRequesterRole(context(), VIEWER)).toBe("viewer");
  });

  it("treats a collaborator with no stored role as a viewer", () => {
    expect(
      resolveRequesterRole(context(), "GNOROLE0000000000000000000000000000000000000000000000")
    ).toBe("viewer");
  });

  it("returns null for an address that is not on the project", () => {
    expect(resolveRequesterRole(context(), STRANGER)).toBeNull();
  });

  it("owner wins even when the owner is also listed as a collaborator", () => {
    const ctx = context({
      collaborators: [{ address: OWNER, role: "viewer" }],
    });
    expect(resolveRequesterRole(ctx, OWNER)).toBe("owner");
  });

  it("returns null rather than throwing on unusable input", () => {
    expect(resolveRequesterRole({ owner: OWNER, collaborators: [] }, STRANGER)).toBeNull();
    expect(resolveRequesterRole(context(), "")).toBeNull();
    expect(resolveRequesterRole(null, OWNER)).toBeNull();
  });
});

describe("assertProjectPermission", () => {
  it("returns the resolved role when the permission is granted", () => {
    expect(assertProjectPermission(context(), ADMIN, "project:invite")).toBe("admin");
    expect(assertProjectPermission(context(), OWNER, "project:delete")).toBe("owner");
  });

  it("denies a viewer attempting a mutation", () => {
    expect(() => assertProjectPermission(context(), VIEWER, "project:delete")).toThrow(
      /permission_denied/
    );
  });

  it("denies a requester who is not on the project", () => {
    let thrown: { status?: number; role?: string | null; reason?: string } = {};
    try {
      assertProjectPermission(context(), STRANGER, "project:read");
    } catch (err) {
      thrown = err as typeof thrown;
    }
    expect(thrown.status).toBe(403);
    expect(thrown.role).toBeNull();
    expect(thrown.reason).toBe("project_role_unknown");
  });

  it("fails closed when the project record is unavailable", () => {
    expect(() => assertProjectPermission(null, OWNER, "project:delete")).toThrow(
      /permission_denied/
    );
  });

  it("cannot be escalated by claiming a role in the request body", () => {
    const viewerCtx = context({
      collaborators: [{ address: STRANGER, role: "viewer" }],
    });
    // The escalation attempt a body-trusting route would honour.
    (viewerCtx as unknown as { claimedRole: string }).claimedRole = "owner";
    expect(() => assertProjectPermission(viewerCtx, STRANGER, "project:delete")).toThrow(
      /permission_denied/
    );
  });
});

describe("createProjectPermissionMiddleware", () => {
  const allow = async () => context();

  it("calls next() and publishes the resolved role when allowed", async () => {
    const req = mockRequest("proj-1");
    const res = mockResponse();
    res.locals.requesterAddress = OWNER;
    const next = vi.fn();

    await createProjectPermissionMiddleware("project:delete", allow)(
      req as never,
      res as never,
      next as never
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(0);
    expect(res.locals.collaboratorRole).toBe("owner");
  });

  it("rejects an unauthenticated request with 401", async () => {
    const res = mockResponse();
    const next = vi.fn();

    await createProjectPermissionMiddleware("project:delete", allow)(
      mockRequest("proj-1") as never,
      res as never,
      next as never
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ error: "unauthorized" });
  });

  it("ignores a role claimed in the request body", async () => {
    const res = mockResponse();
    res.locals.requesterAddress = VIEWER;
    const next = vi.fn();

    await createProjectPermissionMiddleware("project:delete", allow)(
      mockRequest("proj-1", { role: "owner" }) as never,
      res as never,
      next as never
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ error: "permission_denied", role: "viewer" });
  });

  it("fails closed when the project cannot be resolved", async () => {
    const res = mockResponse();
    res.locals.requesterAddress = OWNER;
    const next = vi.fn();

    await createProjectPermissionMiddleware("project:delete", async () => null)(
      mockRequest("missing") as never,
      res as never,
      next as never
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ reason: "project_role_unknown" });
  });

  it("fails closed when the resolver throws", async () => {
    const res = mockResponse();
    res.locals.requesterAddress = OWNER;
    const next = vi.fn();

    await createProjectPermissionMiddleware("project:delete", async () => {
      throw new Error("rpc unavailable");
    })(mockRequest("proj-1") as never, res as never, next as never);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("requires a project id", async () => {
    const res = mockResponse();
    res.locals.requesterAddress = OWNER;
    const next = vi.fn();

    await createProjectPermissionMiddleware("project:delete", allow)(
      mockRequest() as never,
      res as never,
      next as never
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
  });
});
