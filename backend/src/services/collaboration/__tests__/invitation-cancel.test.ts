import { describe, expect, it, beforeEach } from "vitest";
import {
  acceptInvitationByTokenJti,
  cancelInvitation,
  listCancellationEvents,
  listPendingInvitations,
  registerInvitation,
  resetInvitationRegistryForTests,
} from "../invitation-registry.js";

describe("invitation cancellation (issue #1299)", () => {
  beforeEach(() => {
    resetInvitationRegistryForTests();
  });

  it("allows the inviter to cancel a pending invitation", () => {
    const inv = registerInvitation({
      email: "a@example.com",
      tokenJti: "jti-1",
      inviterWalletAddress: "GINVITER",
      projectId: "proj1",
    });
    const cancelled = cancelInvitation({
      invitationId: inv.id,
      actorWalletAddress: "GINVITER",
    });
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelledBy).toBe("GINVITER");
    expect(listCancellationEvents()).toHaveLength(1);
    expect(listCancellationEvents()[0].type).toBe("invitation.cancelled");
  });

  it("rejects cancellation by a non-inviter", () => {
    const inv = registerInvitation({
      email: "b@example.com",
      tokenJti: "jti-2",
      inviterWalletAddress: "GINVITER",
    });
    expect(() =>
      cancelInvitation({ invitationId: inv.id, actorWalletAddress: "GSTRANGER" })
    ).toThrow(/forbidden_not_inviter/);
  });

  it("prevents accepting a cancelled invitation", () => {
    registerInvitation({
      email: "c@example.com",
      tokenJti: "jti-3",
      inviterWalletAddress: "GINVITER",
    });
    const inv = registerInvitation({
      email: "d@example.com",
      tokenJti: "jti-4",
      inviterWalletAddress: "GINVITER",
    });
    cancelInvitation({ invitationId: inv.id, actorWalletAddress: "GINVITER" });
    expect(() => acceptInvitationByTokenJti("jti-4")).toThrow(/invitation_cancelled/);
  });

  it("records cancellation events for audit", () => {
    const inv = registerInvitation({
      email: "e@example.com",
      tokenJti: "jti-5",
      inviterWalletAddress: "GOWNER",
      projectId: "p9",
    });
    cancelInvitation({ invitationId: inv.id, actorWalletAddress: "GOWNER" });
    const ev = listCancellationEvents()[0];
    expect(ev.invitationId).toBe(inv.id);
    expect(ev.email).toBe("e@example.com");
    expect(ev.projectId).toBe("p9");
    expect(ev.cancelledBy).toBe("GOWNER");
  });
});


describe("invitation cancellation authorization (#1299 hardening)", () => {
  beforeEach(() => {
    resetInvitationRegistryForTests();
  });

  it("refuses cancellation when no inviter was recorded", () => {
    const inv = registerInvitation({ email: "f@example.com", tokenJti: "jti-6" });
    expect(() =>
      cancelInvitation({ invitationId: inv.id, actorWalletAddress: "GWHOEVER" })
    ).toThrow(/inviter_unknown/);
    expect(inv.status).toBe("pending");
    expect(listCancellationEvents()).toHaveLength(0);
  });

  it("allows the project owner to cancel when the owner is known", () => {
    const inv = registerInvitation({ email: "g@example.com", tokenJti: "jti-7" });
    const cancelled = cancelInvitation({
      invitationId: inv.id,
      actorWalletAddress: "GOWNER",
      projectOwnerAddress: "GOWNER",
    });
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelledBy).toBe("GOWNER");
    expect(listCancellationEvents()[0].authority).toBe("project_owner");
  });

  it("still refuses an unrelated actor, even with an owner known", () => {
    const inv = registerInvitation({
      email: "h@example.com",
      tokenJti: "jti-8",
      inviterWalletAddress: "GINVITER",
    });
    expect(() =>
      cancelInvitation({
        invitationId: inv.id,
        actorWalletAddress: "GSTRANGER",
        projectOwnerAddress: "GOWNER",
      })
    ).toThrow(/forbidden_not_inviter/);
  });

  it("records which authority permitted the cancellation", () => {
    const inv = registerInvitation({
      email: "i@example.com",
      tokenJti: "jti-9",
      inviterWalletAddress: "GINVITER",
    });
    cancelInvitation({ invitationId: inv.id, actorWalletAddress: "GINVITER" });
    expect(listCancellationEvents()[0].authority).toBe("inviter");
  });

  it("requires an actor to cancel at all", () => {
    const inv = registerInvitation({
      email: "j@example.com",
      tokenJti: "jti-10",
      inviterWalletAddress: "GINVITER",
    });
    expect(() =>
      cancelInvitation({ invitationId: inv.id, actorWalletAddress: "   " })
    ).toThrow(/actor_required/);
  });

  it("leaves an unknown invitation as a 404", () => {
    expect(() =>
      cancelInvitation({ invitationId: "inv_missing", actorWalletAddress: "GINVITER" })
    ).toThrow(/invitation_not_found/);
  });

  it("lists pending invitations so an owner can find one to cancel", () => {
    const pending = registerInvitation({
      email: "k@example.com",
      tokenJti: "jti-11",
      inviterWalletAddress: "GINVITER",
      projectId: "proj-a",
    });
    const other = registerInvitation({
      email: "l@example.com",
      tokenJti: "jti-12",
      inviterWalletAddress: "GINVITER",
      projectId: "proj-b",
    });
    const accepted = registerInvitation({
      email: "m@example.com",
      tokenJti: "jti-13",
      inviterWalletAddress: "GINVITER",
      projectId: "proj-a",
    });
    acceptInvitationByTokenJti("jti-13");

    const forProject = listPendingInvitations({ projectId: "proj-a" });
    expect(forProject.map((r) => r.id)).toEqual([pending.id]);

    const all = listPendingInvitations();
    expect(all.map((r) => r.id).sort()).toEqual([pending.id, other.id].sort());
    expect(all).not.toContainEqual(expect.objectContaining({ id: accepted.id }));

    cancelInvitation({
      invitationId: pending.id,
      actorWalletAddress: "GINVITER",
    });
    expect(listPendingInvitations({ projectId: "proj-a" })).toHaveLength(0);
  });
});
