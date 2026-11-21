import { z } from "zod";

/**
 * Zod schemas for collaboration endpoint responses (#1618).
 *
 * These pin the payload shapes consumed by the dashboard and by collaboration
 * tooling: invitations, project membership and roles, the permissions matrix,
 * ownership transfer records, and project deletion decisions. Route handlers
 * validate against them with `withResponseValidation`, so an accidental field
 * rename or a new required field fails loudly instead of silently breaking a
 * client.
 */

// ── Shared primitives ────────────────────────────────────────────────────────

/**
 * Response addresses are opaque strings on purpose: the ownership service
 * normalises addresses to upper case, and legacy records may predate address
 * validation. Pinning the shape (not the checksum) avoids rejecting a stored
 * record that the endpoint is contractually required to return verbatim.
 */
export const CollaborationAddressSchema = z.string().min(1);

export const CollaboratorRoleSchema = z.enum(["owner", "admin", "editor", "viewer"]);

export const AssignableCollaboratorRoleSchema = z.enum(["admin", "editor", "viewer"]);

// ── Invitations ──────────────────────────────────────────────────────────────

export const InvitationStatusSchema = z.enum(["pending", "accepted", "cancelled", "expired"]);

export const InvitationRecordSchema = z.object({
  id: z.string().min(1).describe("Server-generated invitation id"),
  email: z.string().email().describe("Lower-cased invitee email"),
  tokenJti: z.string().min(1).describe("Single-use token id the invitation was issued with"),
  projectId: z.string().optional().describe("Project the invitee is joining"),
  inviterWalletAddress: CollaborationAddressSchema.optional().describe(
    "Authenticated address that sent the invitation"
  ),
  status: InvitationStatusSchema,
  createdAt: z.string().describe("ISO timestamp when the invitation was created"),
  expiresAt: z.string().describe("ISO timestamp after which the invitation cannot be accepted"),
  cancelledAt: z.string().optional(),
  cancelledBy: CollaborationAddressSchema.optional(),
  acceptedAt: z.string().optional(),
  expiredAt: z.string().optional(),
});

export type InvitationRecordResponse = z.infer<typeof InvitationRecordSchema>;

export const InvitationResponseSchema = z.object({
  invitation: InvitationRecordSchema,
});

// ── Membership and roles ─────────────────────────────────────────────────────

export const CollaboratorMembershipSchema = z.object({
  address: CollaborationAddressSchema,
  role: AssignableCollaboratorRoleSchema,
});

export const CollaborationMembershipSchema = z.object({
  projectId: z.string().min(1),
  owner: CollaborationAddressSchema,
  collaborators: z.array(CollaboratorMembershipSchema),
  version: z
    .number()
    .int()
    .nonnegative()
    .describe("Optimistic-concurrency version of the collaboration record"),
});

export type CollaborationMembershipResponse = z.infer<typeof CollaborationMembershipSchema>;

export const RolePermissionsSchema = z.object({
  role: CollaboratorRoleSchema,
  permissions: z.array(z.string().min(1)).describe("Permissions granted to the role"),
});

export const PermissionsMatrixResponseSchema = z.object({
  roles: z.array(RolePermissionsSchema),
});

export type PermissionsMatrixResponse = z.infer<typeof PermissionsMatrixResponseSchema>;

// ── Ownership ────────────────────────────────────────────────────────────────

export const OwnershipTransferRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  fromOwner: CollaborationAddressSchema,
  toOwner: CollaborationAddressSchema,
  authorizedBy: CollaborationAddressSchema,
  transferredAt: z.string().describe("ISO timestamp of the transfer"),
});

export const OwnershipAuditEntrySchema = z.object({
  action: z.literal("ownership.transferred"),
  projectId: z.string().min(1),
  fromOwner: CollaborationAddressSchema,
  toOwner: CollaborationAddressSchema,
  authorizedBy: CollaborationAddressSchema,
  at: z.string(),
});

export const OwnershipTransferResponseSchema = z.object({
  transfer: OwnershipTransferRecordSchema,
  isNewOwner: z.boolean().describe("Whether the requested address owns the project now"),
  audit: z.array(OwnershipAuditEntrySchema),
});

export type OwnershipTransferResponse = z.infer<typeof OwnershipTransferResponseSchema>;

// ── Project deletion ─────────────────────────────────────────────────────────

export const DeletionDecisionSchema = z.object({
  allowed: z.boolean(),
  mode: z.enum(["hard", "soft"]).nullable(),
  reason: z.string(),
  requiresConfirmation: z.boolean(),
  confirmationPhrase: z.string(),
});

export const ProjectDeletionResponseSchema = z.object({
  success: z.literal(true),
  role: CollaboratorRoleSchema.nullable().describe("Role the authenticated requester acted with"),
  decision: DeletionDecisionSchema,
});

export type ProjectDeletionResponse = z.infer<typeof ProjectDeletionResponseSchema>;
