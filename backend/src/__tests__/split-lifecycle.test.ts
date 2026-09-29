import { describe, expect, it } from "vitest";
import {
  SPLIT_STATES,
  assertActionAllowed,
  deriveParticipantStatuses,
  deriveSplitState,
  isActionAllowed,
  isCancellable,
  isTerminal,
  summariseCompletion,
  type Collaborator,
  type PaymentRecord,
  type ProjectSnapshot,
  type SplitAction,
} from "../lib/split-lifecycle.js";

function project(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    projectId: "p1",
    locked: false,
    balance: "0",
    totalDistributed: "0",
    distributionRound: 0,
    collaborators: [],
    ...overrides,
  };
}

function collab(address: string, basisPoints = 5000): Collaborator {
  return { address, alias: `alias-${address}`, basisPoints };
}

function payment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    recipient: "GA",
    status: "completed",
    roundId: "r1",
    timestamp: 1_000,
    ...overrides,
  };
}

describe("deriveSplitState", () => {
  it("is draft when nothing has been funded or distributed", () => {
    expect(deriveSplitState(project())).toBe("draft");
  });

  it("is active once funded but not locked", () => {
    expect(deriveSplitState(project({ balance: "100" }))).toBe("active");
  });

  it("is distributing when locked with a balance still to pay out", () => {
    expect(deriveSplitState(project({ locked: true, balance: "100" }))).toBe(
      "distributing",
    );
  });

  it("is settled when locked and drained", () => {
    expect(
      deriveSplitState(project({ locked: true, balance: "0", totalDistributed: "500" })),
    ).toBe("settled");
  });

  it("is settled when unlocked but everything distributed", () => {
    expect(
      deriveSplitState(project({ balance: "0", totalDistributed: "500" })),
    ).toBe("settled");
  });

  it("does not call an unfunded split settled", () => {
    // Zero balance alone is not completion — nobody ever funded this. Calling
    // it settled would overstate how much has been paid out.
    expect(deriveSplitState(project({ balance: "0", totalDistributed: "0" }))).toBe(
      "draft",
    );
  });

  it("treats cancellation as overriding every other signal", () => {
    const cancellation = {
      cancelledAt: new Date(),
      cancelledBy: "GOWNER",
      reason: null,
    };
    expect(
      deriveSplitState(project({ balance: "100", locked: true }), cancellation),
    ).toBe("cancelled");
    expect(
      deriveSplitState(project({ totalDistributed: "50" }), cancellation),
    ).toBe("cancelled");
  });

  it("handles balances far beyond Number.MAX_SAFE_INTEGER", () => {
    // Stroops on a large split overflow float arithmetic; the derivation uses
    // BigInt so a huge balance is not silently rounded to zero.
    const huge = "9007199254740993000";
    expect(deriveSplitState(project({ balance: huge }))).toBe("active");
  });

  it("treats unparseable balances as zero rather than throwing", () => {
    expect(deriveSplitState(project({ balance: "" }))).toBe("draft");
    expect(deriveSplitState(project({ balance: "not-a-number" }))).toBe("draft");
  });
});

describe("isTerminal / isCancellable", () => {
  it("marks settled and cancelled as terminal", () => {
    expect(isTerminal("settled")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);
    expect(isTerminal("active")).toBe(false);
    expect(isTerminal("distributing")).toBe(false);
  });

  it("allows cancelling only before distribution begins", () => {
    expect(isCancellable("draft")).toBe(true);
    expect(isCancellable("active")).toBe(true);
    // Once distribution is under way or done, cancelling would rewrite history.
    expect(isCancellable("distributing")).toBe(false);
    expect(isCancellable("settled")).toBe(false);
    expect(isCancellable("cancelled")).toBe(false);
  });
});

describe("deriveParticipantStatuses", () => {
  it("reports unpaid when no record exists", () => {
    const [status] = deriveParticipantStatuses([collab("GA")], []);
    expect(status.status).toBe("unpaid");
    expect(status.roundId).toBeNull();
    expect(status.lastUpdated).toBeNull();
  });

  it("distinguishes unpaid from failed", () => {
    const [unpaid] = deriveParticipantStatuses([collab("GA")], []);
    const [failed] = deriveParticipantStatuses(
      [collab("GA")],
      [payment({ recipient: "GA", status: "failed" })],
    );
    expect(unpaid.status).toBe("unpaid");
    expect(failed.status).toBe("failed");
  });

  it("reports pending while a payment is in flight", () => {
    const [status] = deriveParticipantStatuses(
      [collab("GA")],
      [payment({ recipient: "GA", status: "pending" })],
    );
    expect(status.status).toBe("pending");
  });

  it("lets a later success supersede an earlier failure", () => {
    const [status] = deriveParticipantStatuses(
      [collab("GA")],
      [
        payment({ recipient: "GA", status: "failed", timestamp: 1 }),
        payment({ recipient: "GA", status: "completed", timestamp: 2 }),
      ],
    );
    expect(status.status).toBe("paid");
  });

  it("does not let a stray later failure unpay a paid participant", () => {
    // Taking merely the newest record would flip this to failed, telling
    // someone their completed payout had failed.
    const [status] = deriveParticipantStatuses(
      [collab("GA")],
      [
        payment({ recipient: "GA", status: "completed", timestamp: 2 }),
        payment({ recipient: "GA", status: "failed", timestamp: 9 }),
      ],
    );
    expect(status.status).toBe("paid");
  });

  it("prefers a pending retry over a historical failure", () => {
    const [status] = deriveParticipantStatuses(
      [collab("GA")],
      [
        payment({ recipient: "GA", status: "failed", timestamp: 1 }),
        payment({ recipient: "GA", status: "pending", timestamp: 2 }),
      ],
    );
    expect(status.status).toBe("pending");
  });

  it("keeps the most recent record when status is unchanged", () => {
    const [status] = deriveParticipantStatuses(
      [collab("GA")],
      [
        payment({ recipient: "GA", status: "completed", roundId: "r1", timestamp: 1 }),
        payment({ recipient: "GA", status: "completed", roundId: "r2", timestamp: 5 }),
      ],
    );
    expect(status.roundId).toBe("r2");
    expect(status.lastUpdated).toBe(5);
  });

  it("matches addresses case-insensitively", () => {
    const [status] = deriveParticipantStatuses(
      [collab("gabc")],
      [payment({ recipient: "GABC", status: "completed" })],
    );
    expect(status.status).toBe("paid");
  });

  it("does not attribute one participant's payment to another", () => {
    const statuses = deriveParticipantStatuses(
      [collab("GA"), collab("GB")],
      [payment({ recipient: "GA", status: "completed" })],
    );
    expect(statuses.find((s) => s.address === "GA")?.status).toBe("paid");
    expect(statuses.find((s) => s.address === "GB")?.status).toBe("unpaid");
  });

  it("preserves alias and share for display", () => {
    const [status] = deriveParticipantStatuses([collab("GA", 2500)], []);
    expect(status.alias).toBe("alias-GA");
    expect(status.basisPoints).toBe(2500);
  });
});

describe("summariseCompletion", () => {
  it("counts paid participants and outstanding share", () => {
    const summary = summariseCompletion(
      project({
        balance: "100",
        collaborators: [collab("GA", 6000), collab("GB", 4000)],
      }),
      [payment({ recipient: "GA", status: "completed" })],
    );

    expect(summary.paidCount).toBe(1);
    expect(summary.totalParticipants).toBe(2);
    expect(summary.allParticipantsPaid).toBe(false);
    expect(summary.outstandingBasisPoints).toBe(4000);
  });

  it("reports everyone paid once all records complete", () => {
    const summary = summariseCompletion(
      project({
        locked: true,
        balance: "0",
        totalDistributed: "100",
        collaborators: [collab("GA", 5000), collab("GB", 5000)],
      }),
      [
        payment({ recipient: "GA", status: "completed" }),
        payment({ recipient: "GB", status: "completed" }),
      ],
    );

    expect(summary.state).toBe("settled");
    expect(summary.allParticipantsPaid).toBe(true);
    expect(summary.outstandingBasisPoints).toBe(0);
  });

  it("can be settled on-chain while a payout record is still pending", () => {
    // The two signals are kept separate on purpose: collapsing them would
    // hide an in-flight payout from the person waiting on it.
    const summary = summariseCompletion(
      project({
        locked: true,
        balance: "0",
        totalDistributed: "100",
        collaborators: [collab("GA", 5000), collab("GB", 5000)],
      }),
      [
        payment({ recipient: "GA", status: "completed" }),
        payment({ recipient: "GB", status: "pending" }),
      ],
    );

    expect(summary.state).toBe("settled");
    expect(summary.allParticipantsPaid).toBe(false);
    expect(summary.outstandingBasisPoints).toBe(5000);
  });

  it("does not claim everyone is paid when there are no participants", () => {
    const summary = summariseCompletion(project(), []);
    expect(summary.totalParticipants).toBe(0);
    expect(summary.allParticipantsPaid).toBe(false);
  });
});


describe("isActionAllowed / assertActionAllowed (#1305)", () => {
  const mutating: SplitAction[] = [
    "deposit",
    "update_metadata",
    "update_collaborators",
    "lock",
    "distribute",
    "cancel",
  ];

  it("permits every mutating action on a draft or active split", () => {
    for (const action of mutating) {
      expect(isActionAllowed("draft", action)).toBe(true);
      expect(isActionAllowed("active", action)).toBe(true);
    }
  });

  it("permits only distribution while a split is distributing", () => {
    expect(isActionAllowed("distributing", "distribute")).toBe(true);
    for (const action of mutating.filter((a) => a !== "distribute")) {
      expect(isActionAllowed("distributing", action)).toBe(false);
    }
  });

  it("permits no mutation once a split is settled", () => {
    for (const action of mutating) {
      expect(isActionAllowed("settled", action)).toBe(false);
    }
  });

  it("permits no mutation once a split is cancelled", () => {
    for (const action of mutating) {
      expect(isActionAllowed("cancelled", action)).toBe(false);
    }
  });

  it("always permits reading, in every state", () => {
    for (const state of SPLIT_STATES) {
      expect(isActionAllowed(state, "read")).toBe(true);
    }
  });

  it("keeps cancellation consistent with isCancellable", () => {
    for (const state of SPLIT_STATES) {
      expect(isCancellable(state)).toBe(isActionAllowed(state, "cancel"));
    }
  });

  it("throws a 409 naming the state and action", () => {
    let thrown: { code?: string; status?: number; state?: string; action?: string } = {};
    try {
      assertActionAllowed("settled", "deposit");
    } catch (err) {
      thrown = err as typeof thrown;
    }
    expect(thrown.code).toBe("split_not_mutable");
    expect(thrown.status).toBe(409);
    expect(thrown.state).toBe("settled");
    expect(thrown.action).toBe("deposit");
  });

  it("does not throw when the action is permitted", () => {
    expect(() => assertActionAllowed("active", "distribute")).not.toThrow();
    expect(() => assertActionAllowed("settled", "read")).not.toThrow();
  });

  it("refuses a second cancellation of a cancelled split", () => {
    expect(() => assertActionAllowed("cancelled", "cancel")).toThrow(/split_not_mutable/);
  });
});
