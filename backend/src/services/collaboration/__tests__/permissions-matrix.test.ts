import { describe, expect, it } from "vitest";
import {
  COLLABORATOR_ROLES,
  PROJECT_PERMISSIONS,
  ROLE_PERMISSIONS,
  assertPermission,
  getPermissionsMatrix,
  resolveCollaboratorRole,
  roleHasPermission,
} from "../permissions.js";

describe("collaborator role permissions (issue #1300)", () => {
  it("defines supported roles", () => {
    expect(COLLABORATOR_ROLES).toEqual(["owner", "admin", "editor", "viewer"]);
  });

  it("defines permissions per role (matrix completeness)", () => {
    const matrix = getPermissionsMatrix();
    expect(matrix).toHaveLength(4);
    for (const row of matrix) {
      expect(row.permissions.length).toBeGreaterThan(0);
      for (const p of row.permissions) {
        expect(PROJECT_PERMISSIONS).toContain(p);
      }
    }
  });

  it("owner has all permissions", () => {
    for (const p of PROJECT_PERMISSIONS) {
      expect(roleHasPermission("owner", p)).toBe(true);
    }
  });

  it("viewer cannot update collaborators or delete", () => {
    expect(roleHasPermission("viewer", "project:update_collaborators")).toBe(false);
    expect(roleHasPermission("viewer", "project:delete")).toBe(false);
    expect(roleHasPermission("viewer", "project:read")).toBe(true);
  });

  it("admin cannot lock or delete but can invite", () => {
    expect(roleHasPermission("admin", "project:lock")).toBe(false);
    expect(roleHasPermission("admin", "project:delete")).toBe(false);
    expect(roleHasPermission("admin", "project:invite")).toBe(true);
  });

  it("assertPermission throws for missing grants", () => {
    expect(() => assertPermission("viewer", "project:delete")).toThrow(/permission_denied/);
  });

  it("resolveCollaboratorRole maps owner and listed roles", () => {
    expect(
      resolveCollaboratorRole({
        requesterAddress: "GOWNER",
        ownerAddress: "GOWNER",
        collaborators: [],
      })
    ).toBe("owner");
    expect(
      resolveCollaboratorRole({
        requesterAddress: "GEDIT",
        ownerAddress: "GOWNER",
        collaborators: [{ address: "GEDIT", role: "editor" }],
      })
    ).toBe("editor");
    expect(
      resolveCollaboratorRole({
        requesterAddress: "GUNKNOWN",
        ownerAddress: "GOWNER",
        collaborators: [],
      })
    ).toBeNull();
  });

  it("permissions matrix is consistent with ROLE_PERMISSIONS", () => {
    for (const role of COLLABORATOR_ROLES) {
      expect(ROLE_PERMISSIONS[role]).toEqual(
        getPermissionsMatrix().find((r) => r.role === role)?.permissions
      );
    }
  });
});
