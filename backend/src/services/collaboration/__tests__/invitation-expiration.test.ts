import { describe, it, expect, beforeEach } from "vitest";
import {
  resetInvitationRegistryForTests,
  registerInvitation,
  acceptInvitationByTokenJti,
  reinvite,
  listPendingInvitations,
  listExpiredEvents,
  isInvitationExpired,
  DEFAULT_INVITATION_TTL_MS,
} from "../invitation-registry.js";

describe("invitation expiration (#1298)", () => {
  beforeEach(() => {
    resetInvitationRegistryForTests();
  });

  it("assigns an expiration time on register", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const inv = registerInvitation({
      email: "a@example.com",
      tokenJti: "jti-1",
      projectId: "proj1",
      inviterWalletAddress: "GINVITER",
      now,
    });
    expect(new Date(inv.expiresAt).getTime()).toBe(
      now.getTime() + DEFAULT_INVITATION_TTL_MS,
    );
    expect(inv.status).toBe("pending");
  });

  it("rejects accepting an expired invitation", () => {
    const created = new Date("2026-01-01T00:00:00.000Z");
    registerInvitation({
      email: "a@example.com",
      tokenJti: "jti-exp",
      projectId: "proj1",
      inviterWalletAddress: "GINVITER",
      ttlMs: 1000,
      now: created,
    });
    const later = new Date(created.getTime() + 5000);
    expect(() => acceptInvitationByTokenJti("jti-exp", later)).toThrow(
      /invitation_expired/,
    );
    expect(listExpiredEvents().length).toBe(1);
  });

  it("allows safe re-invitation after expiry", () => {
    const created = new Date("2026-01-01T00:00:00.000Z");
    registerInvitation({
      email: "a@example.com",
      tokenJti: "jti-old",
      projectId: "proj1",
      inviterWalletAddress: "GINVITER",
      ttlMs: 1000,
      now: created,
    });
    const later = new Date(created.getTime() + 5000);
    const renewed = reinvite({
      email: "a@example.com",
      tokenJti: "jti-new",
      projectId: "proj1",
      inviterWalletAddress: "GINVITER",
      ttlMs: 60_000,
      now: later,
    });
    expect(renewed.tokenJti).toBe("jti-new");
    expect(renewed.status).toBe("pending");
    expect(isInvitationExpired(renewed, later)).toBe(false);
    expect(acceptInvitationByTokenJti("jti-new", later).status).toBe(
      "accepted",
    );
  });

  it("cancels a pending invitation before issuing its replacement", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const original = registerInvitation({
      email: "a@example.com",
      tokenJti: "jti-pending-old",
      projectId: "proj1",
      inviterWalletAddress: "GINVITER",
      now,
    });

    const replacement = reinvite({
      email: "a@example.com",
      tokenJti: "jti-pending-new",
      projectId: "proj1",
      inviterWalletAddress: "GINVITER",
      now: new Date(now.getTime() + 1000),
    });

    expect(original.status).toBe("cancelled");
    expect(replacement.status).toBe("pending");
    expect(() => acceptInvitationByTokenJti("jti-pending-old")).toThrow(
      /invitation_cancelled/,
    );
    expect(acceptInvitationByTokenJti("jti-pending-new").status).toBe(
      "accepted",
    );
  });

  it("excludes expired invites from pending list", () => {
    const created = new Date("2026-01-01T00:00:00.000Z");
    registerInvitation({
      email: "a@example.com",
      tokenJti: "jti-1",
      projectId: "proj1",
      inviterWalletAddress: "GINVITER",
      ttlMs: 1000,
      now: created,
    });
    const later = new Date(created.getTime() + 5000);
    expect(listPendingInvitations({ projectId: "proj1", now: later })).toEqual(
      [],
    );
  });
});
