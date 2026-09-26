/**
 * Issue #1300 – Collaborator role permissions matrix.
 *
 * Roles define what a collaborator may do on a split project. Enforcement is
 * server-side via `assertPermission`.
 */

export const COLLABORATOR_ROLES = ["owner", "admin", "editor", "viewer"] as const;
export type CollaboratorRole = (typeof COLLABORATOR_ROLES)[number];

export const PROJECT_PERMISSIONS = [
  "project:read",
  "project:update_metadata",
  "project:update_collaborators",
  "project:lock",
  "project:delete",
  "project:invite",
  "project:cancel_invite",
  "funds:deposit",
  "funds:distribute",
  "funds:claim",
] as const;
export type ProjectPermission = (typeof PROJECT_PERMISSIONS)[number];

/** Permissions granted to each role (issue #1300 matrix). */
export const ROLE_PERMISSIONS: Record<CollaboratorRole, readonly ProjectPermission[]> = {
  owner: [
    "project:read",
    "project:update_metadata",
    "project:update_collaborators",
    "project:lock",
    "project:delete",
    "project:invite",
    "project:cancel_invite",
    "funds:deposit",
    "funds:distribute",
    "funds:claim",
  ],
  admin: [
    "project:read",
    "project:update_metadata",
    "project:update_collaborators",
    "project:invite",
    "project:cancel_invite",
    "funds:deposit",
    "funds:distribute",
    "funds:claim",
  ],
  editor: [
    "project:read",
    "project:update_metadata",
    "funds:deposit",
    "funds:claim",
  ],
  viewer: ["project:read", "funds:claim"],
};

export function roleHasPermission(
  role: CollaboratorRole,
  permission: ProjectPermission
): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function assertPermission(
  role: CollaboratorRole,
  permission: ProjectPermission
): void {
  if (!roleHasPermission(role, permission)) {
    throw Object.assign(
      new Error(`permission_denied: ${role} lacks ${permission}`),
      { code: "permission_denied", status: 403, role, permission }
    );
  }
}

/**
 * Resolve the highest role for an address on a project.
 * Owner address always maps to `owner`. Collaborator list may carry optional role.
 */
export function resolveCollaboratorRole(input: {
  requesterAddress: string;
  ownerAddress: string;
  collaborators: Array<{ address: string; role?: CollaboratorRole }>;
}): CollaboratorRole | null {
  const req = input.requesterAddress.trim();
  if (req === input.ownerAddress.trim()) {
    return "owner";
  }
  const match = input.collaborators.find((c) => c.address.trim() === req);
  if (!match) return null;
  return match.role ?? "viewer";
}

/** Full matrix for tests / documentation. */
export function getPermissionsMatrix(): Array<{
  role: CollaboratorRole;
  permissions: readonly ProjectPermission[];
}> {
  return COLLABORATOR_ROLES.map((role) => ({
    role,
    permissions: ROLE_PERMISSIONS[role],
  }));
}
