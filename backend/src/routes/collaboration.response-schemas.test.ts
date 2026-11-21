import express from "express";
import request from "supertest";
import { Keypair } from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it } from "vitest";

import {
  collaborationRouter,
  setProjectDeletionSnapshotResolver,
  setProjectRoleContextResolver,
} from "./collaboration.js";
import { errorHandler, notFoundHandler } from "../middleware/error.js";
import { requestIdMiddleware } from "../middleware/request-id.js";
import {
  getValidationFailureCount,
  resetValidationFailureCount,
} from "../middleware/validateResponse.js";
import {
  CONFIRMATION_PHRASE,
  resetProjectDeletionAuditForTests,
} from "../services/collaboration/project-deletion.js";
import {
  registerInvitation,
  resetInvitationRegistryForTests,
} from "../services/collaboration/invitation-registry.js";
import { resetOwnershipTransferForTests } from "../services/splits/ownership-transfer.js";
import {
  applyCollaborationChange,
  createInMemoryCollaborationStore,
} from "../services/collaboration/membership-changes.js";
import {
  CollaborationMembershipSchema,
  InvitationResponseSchema,
  OwnershipTransferResponseSchema,
  PermissionsMatrixResponseSchema,
  ProjectDeletionResponseSchema,
} from "../schemas/collaboration.schemas.js";

/**
 * Response-contract coverage for the collaboration routes (#1618).
 *
 * Every success payload is parsed with its schema *and* the server's
 * `withResponseValidation` failure counter is asserted at zero, so a route that
 * silently drops a field is caught even when the schema is not strict.
 */
const createApp = () => {
  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware);
  app.use("/collaboration", collaborationRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};

describe("collaboration response schemas (#1618)", () => {
  let owner: string;
  let admin: string;
  let newOwner: string;

  beforeEach(() => {
    owner = Keypair.random().publicKey();
    admin = Keypair.random().publicKey();
    newOwner = Keypair.random().publicKey();
    resetInvitationRegistryForTests();
    resetOwnershipTransferForTests();
    resetProjectDeletionAuditForTests();
    resetValidationFailureCount();
    setProjectRoleContextResolver(async () => ({
      owner,
      collaborators: [{ address: admin, role: "admin" }],
    }));
    setProjectDeletionSnapshotResolver(async (projectId) => ({
      projectId,
      hasDeposits: true,
      hasDistributions: false,
      hasClaims: false,
      transactionCount: 1,
    }));
  });

  it("pins the permissions matrix (role) response", async () => {
    const response = await request(createApp())
      .get("/collaboration/permissions/matrix")
      .expect(200);

    expect(() => PermissionsMatrixResponseSchema.parse(response.body)).not.toThrow();
    expect(response.body.roles.map((role: { role: string }) => role.role)).toEqual([
      "owner",
      "admin",
      "editor",
      "viewer",
    ]);
    expect(getValidationFailureCount()).toBe(0);
  });

  it("pins the invitation response for create, accept, and cancel", async () => {
    const created = await request(createApp())
      .post("/collaboration/projects/project_1/invitations")
      .set("X-Stellar-Address", admin)
      .send({ email: "person@example.com", tokenJti: "jti-response" })
      .expect(201);

    expect(() => InvitationResponseSchema.parse(created.body)).not.toThrow();
    expect(created.body.invitation).toMatchObject({
      status: "pending",
      email: "person@example.com",
      projectId: "project_1",
    });

    const accepted = await request(createApp())
      .post("/collaboration/invitations/accept")
      .send({ tokenJti: "jti-response" })
      .expect(200);
    expect(() => InvitationResponseSchema.parse(accepted.body)).not.toThrow();
    expect(accepted.body.invitation.status).toBe("accepted");

    const pending = registerInvitation({
      email: "cancel@example.com",
      tokenJti: "jti-cancel",
      projectId: "project_1",
      inviterWalletAddress: admin,
    });
    const cancelled = await request(createApp())
      .post(`/collaboration/invitations/${pending.id}/cancel`)
      .set("X-Stellar-Address", admin)
      .send({})
      .expect(200);
    expect(() => InvitationResponseSchema.parse(cancelled.body)).not.toThrow();
    expect(cancelled.body.invitation).toMatchObject({
      status: "cancelled",
      cancelledBy: admin,
    });

    expect(getValidationFailureCount()).toBe(0);
  });

  it("pins the ownership transfer and audit response", async () => {
    const response = await request(createApp())
      .post("/collaboration/projects/project_1/transfer-ownership")
      .set("X-Stellar-Address", owner)
      .send({ newOwner })
      .expect(200);

    expect(() => OwnershipTransferResponseSchema.parse(response.body)).not.toThrow();
    expect(response.body.transfer).toMatchObject({
      projectId: "project_1",
      fromOwner: owner,
      toOwner: newOwner,
      authorizedBy: owner,
    });
    expect(response.body.audit).toEqual([
      expect.objectContaining({ action: "ownership.transferred", projectId: "project_1" }),
    ]);
    expect(getValidationFailureCount()).toBe(0);
  });

  it("pins the project deletion decision response", async () => {
    const response = await request(createApp())
      .post("/collaboration/projects/project_1/delete")
      .set("X-Stellar-Address", owner)
      .send({ confirmed: true, confirmationText: CONFIRMATION_PHRASE })
      .expect(200);

    expect(() => ProjectDeletionResponseSchema.parse(response.body)).not.toThrow();
    expect(response.body).toMatchObject({
      success: true,
      role: "owner",
      decision: { allowed: true, mode: "soft" },
    });
    expect(getValidationFailureCount()).toBe(0);
  });

  it("pins the membership record produced by collaboration changes", async () => {
    const store = createInMemoryCollaborationStore([
      {
        projectId: "project_1",
        owner,
        collaborators: [{ address: admin, role: "admin" }],
        version: 1,
      },
    ]);

    const record = await applyCollaborationChange(store, {
      projectId: "project_1",
      actorAddress: owner,
      change: { type: "add", address: newOwner, role: "editor" },
    });

    expect(() => CollaborationMembershipSchema.parse(record)).not.toThrow();
    expect(record).toMatchObject({
      projectId: "project_1",
      owner,
      version: 2,
      collaborators: [
        { address: admin, role: "admin" },
        { address: newOwner, role: "editor" },
      ],
    });
  });

  it("rejects drifted payloads so a field rename cannot pass silently", () => {
    const drifted = {
      invitation: {
        id: "inv_1",
        // `expiresAt` removed, `status` renamed: exactly the kind of drift the
        // schema exists to catch.
        email: "person@example.com",
        tokenJti: "jti",
        status: "pending",
        createdAt: "2026-11-20T00:00:00.000Z",
      },
    };

    expect(InvitationResponseSchema.safeParse(drifted).success).toBe(false);
  });
});
