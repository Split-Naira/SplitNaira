import { describe, it, expect, beforeEach } from "vitest";
import {
  resetSplitExpirationRegistryForTests,
  configureExpiration,
  isSplitExpired,
  assertNotExpired,
  listExpirationEvents,
} from "../split-expiration.registry.js";
import { deriveSplitState } from "../../../lib/split-lifecycle.js";

describe("split expiration (#1303)", () => {
  beforeEach(() => {
    resetSplitExpirationRegistryForTests();
  });

  it("defines optional expiration and validates against creation time", () => {
    const created = new Date("2026-06-01T00:00:00.000Z");
    expect(() =>
      configureExpiration({
        projectId: "proj1",
        createdAt: created,
        expiresAt: new Date("2026-05-01T00:00:00.000Z"),
        actor: "GOWNER",
        now: created,
      }),
    ).toThrow(/expiration_before_creation/);

    const record = configureExpiration({
      projectId: "proj1",
      createdAt: created,
      expiresAt: new Date("2026-07-01T00:00:00.000Z"),
      actor: "GOWNER",
      now: created,
    });
    expect(record.expiresAt).toBe("2026-07-01T00:00:00.000Z");
    expect(listExpirationEvents("proj1")[0]?.type).toBe(
      "expiration.configured",
    );
  });

  it("prevents actions after expiration and records lifecycle transition", () => {
    const created = new Date("2026-06-01T00:00:00.000Z");
    configureExpiration({
      projectId: "proj1",
      createdAt: created,
      expiresAt: new Date("2026-07-01T00:00:00.000Z"),
      actor: "GOWNER",
      now: created,
    });
    const after = new Date("2026-07-02T00:00:00.000Z");
    expect(isSplitExpired("proj1", after)).toBe(true);
    expect(() => assertNotExpired("proj1", after)).toThrow(/split_expired/);
    expect(
      listExpirationEvents("proj1").some((e) => e.type === "expiration.reached"),
    ).toBe(true);
  });

  it("deriveSplitState returns expired when past deadline", () => {
    const state = deriveSplitState(
      {
        projectId: "proj1",
        locked: false,
        balance: 100n,
        totalDistributed: 0n,
        distributionRound: 0,
        collaborators: [],
        expiresAt: "2026-01-01T00:00:00.000Z",
      },
      null,
      new Date("2026-02-01T00:00:00.000Z"),
    );
    expect(state).toBe("expired");
  });
});
