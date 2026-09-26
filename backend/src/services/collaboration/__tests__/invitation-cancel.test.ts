import { describe, expect, it, beforeEach } from "vitest";
import {
  acceptInvitationByTokenJti,
  cancelInvitation,
  listCancellationEvents,
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
