import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import type { TransactionAttempt } from "../entities/TransactionAttempt.js";
import { SUBMISSION_EXPIRY_MS } from "./transaction-recovery.js";
import {
  DEFAULT_PAYOUT_ALERT_THRESHOLDS,
  NETWORK_PASSPHRASES,
  PayoutAlertConfigurationError,
  buildPendingPayoutAlerts,
  classifyPendingOutcome,
  exitCodeForPayoutAlerts,
  networkNameForPassphrase,
  resolvePayoutAlertThresholds,
} from "./pending-payout-alerts.js";
import { checkPendingPayoutAlerts } from "../scripts/pending-payout-alerts.js";

/**
 * Network-aware pending payout alerts (#1642).
 *
 * Success, failure and boundary cases for threshold resolution, outcome
 * classification and alert building. `submittedAt`/`nowMs` are epoch ms.
 */

const NOW = Date.parse("2026-11-22T12:00:00Z");
const MIN = 60_000;
const SOURCE = "GSOURCE1111111111111111111111111111111111111111111111ABCD";

function attempt(overrides: Partial<TransactionAttempt> = {}): TransactionAttempt {
  return {
    id: "attempt-1",
    txHash: "a".repeat(64),
    projectId: "project_1",
    sourceAccount: SOURCE,
    networkPassphrase: NETWORK_PASSPHRASES.mainnet,
    submittedAt: NOW - 1 * MIN,
    status: "pending",
    failureCode: null,
    failureLedger: null,
    lastCheckedAt: null,
    ...overrides,
  } as TransactionAttempt;
}

const mainnet = { networkPassphrase: NETWORK_PASSPHRASES.mainnet, nowMs: NOW };

describe("networkNameForPassphrase", () => {
  it("recognises the public networks and treats anything else as custom", () => {
    expect(networkNameForPassphrase(NETWORK_PASSPHRASES.mainnet)).toBe("mainnet");
    expect(networkNameForPassphrase(NETWORK_PASSPHRASES.testnet)).toBe("testnet");
    expect(networkNameForPassphrase(NETWORK_PASSPHRASES.futurenet)).toBe("futurenet");
    expect(networkNameForPassphrase("Standalone Network ; February 2017")).toBe("custom");
    expect(networkNameForPassphrase("")).toBe("custom");
  });
});

describe("resolvePayoutAlertThresholds", () => {
  it("uses tighter defaults on mainnet than on test networks", () => {
    const main = resolvePayoutAlertThresholds("mainnet", {});
    const test = resolvePayoutAlertThresholds("testnet", {});
    expect(main).toEqual(DEFAULT_PAYOUT_ALERT_THRESHOLDS.mainnet);
    expect(main.warningMinutes).toBeLessThan(test.warningMinutes);
    expect(main.criticalMinutes).toBeLessThan(test.criticalMinutes);
    expect(resolvePayoutAlertThresholds("custom", {})).toEqual(DEFAULT_PAYOUT_ALERT_THRESHOLDS.testnet);
  });

  it("applies env overrides", () => {
    expect(
      resolvePayoutAlertThresholds("mainnet", {
        PENDING_PAYOUT_ALERT_WARNING_MINUTES: "15",
        PENDING_PAYOUT_ALERT_CRITICAL_MINUTES: "45",
      }),
    ).toEqual({ warningMinutes: 15, criticalMinutes: 45 });
  });

  it.each(["0", "-5", "abc", "NaN", "Infinity"])("rejects invalid value %s", (raw) => {
    expect(() =>
      resolvePayoutAlertThresholds("mainnet", { PENDING_PAYOUT_ALERT_WARNING_MINUTES: raw }),
    ).toThrow(PayoutAlertConfigurationError);
  });

  it("rejects a critical threshold that is not above the warning threshold", () => {
    expect(() =>
      resolvePayoutAlertThresholds("testnet", {
        PENDING_PAYOUT_ALERT_WARNING_MINUTES: "60",
        PENDING_PAYOUT_ALERT_CRITICAL_MINUTES: "60",
      }),
    ).toThrow(/must be greater than/);
  });

  it("rejects a warning threshold inside the submission validity window", () => {
    const windowMinutes = SUBMISSION_EXPIRY_MS / MIN;
    expect(() =>
      resolvePayoutAlertThresholds("mainnet", {
        PENDING_PAYOUT_ALERT_WARNING_MINUTES: String(windowMinutes - 1),
      }),
    ).toThrow(/validity window/);
    expect(
      resolvePayoutAlertThresholds("mainnet", {
        PENDING_PAYOUT_ALERT_WARNING_MINUTES: String(windowMinutes),
      }).warningMinutes,
    ).toBe(windowMinutes);
  });
});

describe("classifyPendingOutcome", () => {
  const pass = NETWORK_PASSPHRASES.mainnet;

  it("is in flight strictly inside the validity window and unknown from its end", () => {
    expect(
      classifyPendingOutcome({ networkPassphrase: pass, submittedAt: NOW - SUBMISSION_EXPIRY_MS + 1 }, pass, NOW),
    ).toBe("in_flight");
    expect(
      classifyPendingOutcome({ networkPassphrase: pass, submittedAt: NOW - SUBMISSION_EXPIRY_MS }, pass, NOW),
    ).toBe("unknown");
  });

  it("flags attempts submitted to another network regardless of age", () => {
    expect(
      classifyPendingOutcome({ networkPassphrase: NETWORK_PASSPHRASES.testnet, submittedAt: NOW }, pass, NOW),
    ).toBe("network_mismatch");
  });
});

describe("buildPendingPayoutAlerts", () => {
  it("raises nothing for a fresh in-flight payout", () => {
    const report = buildPendingPayoutAlerts([attempt()], mainnet);
    expect(report.totalPending).toBe(1);
    expect(report.alerts).toEqual([]);
    expect(exitCodeForPayoutAlerts(report)).toBe(0);
  });

  it("ignores attempts that are already completed or failed", () => {
    const report = buildPendingPayoutAlerts(
      [
        attempt({ status: "completed", submittedAt: NOW - 600 * MIN }),
        attempt({ status: "failed", submittedAt: NOW - 600 * MIN, failureCode: "transaction_expired" }),
      ],
      mainnet,
    );
    expect(report.totalPending).toBe(0);
    expect(report.alerts).toEqual([]);
  });

  it("never treats an unknown outcome as failed or retryable", () => {
    const report = buildPendingPayoutAlerts([attempt({ submittedAt: NOW - 7 * MIN })], mainnet);
    expect(report.alerts).toHaveLength(1);
    const [alert] = report.alerts;
    // 7 minutes is below mainnet's 10-minute warning, but past the 6-minute
    // validity window: unknown outcomes escalate to at least a warning.
    expect(alert).toMatchObject({
      severity: "warning",
      outcome: "unknown",
      retrySafe: false,
      recommendedAction: "verify_on_chain",
      network: "mainnet",
    });
    expect(alert.reason).toMatch(/before any retry/);
    expect(JSON.stringify(report)).not.toMatch(/"failed"|"retry_safe":true|"retrySafe":true/);
  });

  it("applies mainnet boundaries exactly at the thresholds", () => {
    const { warningMinutes, criticalMinutes } = DEFAULT_PAYOUT_ALERT_THRESHOLDS.mainnet;
    const report = buildPendingPayoutAlerts(
      [
        attempt({ id: "just-warning", submittedAt: NOW - warningMinutes * MIN }),
        attempt({ id: "below-critical", submittedAt: NOW - criticalMinutes * MIN + 1 }),
        attempt({ id: "critical", submittedAt: NOW - criticalMinutes * MIN }),
      ],
      mainnet,
    );
    const byId = Object.fromEntries(report.alerts.map((a) => [a.attemptId, a.severity]));
    expect(byId).toEqual({ "just-warning": "warning", "below-critical": "warning", critical: "critical" });
    expect(exitCodeForPayoutAlerts(report)).toBe(2);
  });

  it("is network-aware: the same age is critical on mainnet but only a warning on testnet", () => {
    const age = 45 * MIN;
    const onMain = buildPendingPayoutAlerts([attempt({ submittedAt: NOW - age })], mainnet);
    const onTest = buildPendingPayoutAlerts(
      [attempt({ submittedAt: NOW - age, networkPassphrase: NETWORK_PASSPHRASES.testnet })],
      { networkPassphrase: NETWORK_PASSPHRASES.testnet, nowMs: NOW },
    );
    expect(onMain.alerts[0].severity).toBe("critical");
    expect(onTest.alerts[0].severity).toBe("warning");
    expect(onTest.network).toBe("testnet");
    expect(exitCodeForPayoutAlerts(onTest)).toBe(1);
  });

  it("reports attempts from another network as a mismatch, not against this network's thresholds", () => {
    const report = buildPendingPayoutAlerts(
      [attempt({ networkPassphrase: NETWORK_PASSPHRASES.testnet, submittedAt: NOW - 600 * MIN })],
      mainnet,
    );
    expect(report.alerts[0]).toMatchObject({
      severity: "warning",
      outcome: "network_mismatch",
      network: "testnet",
      recommendedAction: "investigate_network_mismatch",
      retrySafe: false,
    });
    expect(report.counts.networkMismatch).toBe(1);
    expect(report.counts.critical).toBe(0);
  });

  it("honours custom thresholds passed in", () => {
    const report = buildPendingPayoutAlerts([attempt({ submittedAt: NOW - 20 * MIN })], {
      ...mainnet,
      thresholds: { warningMinutes: 15, criticalMinutes: 20 },
    });
    expect(report.alerts[0].severity).toBe("critical");
    expect(report.thresholds).toEqual({ warningMinutes: 15, criticalMinutes: 20 });
  });

  it("clamps future submittedAt to age 0 and warns", () => {
    const report = buildPendingPayoutAlerts([attempt({ submittedAt: NOW + 5 * MIN })], mainnet);
    expect(report.alerts).toEqual([]);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toMatch(/in the future/);
  });

  it("masks source accounts and orders critical first, then oldest", () => {
    const report = buildPendingPayoutAlerts(
      [
        attempt({ id: "w-young", submittedAt: NOW - 11 * MIN }),
        attempt({ id: "c-young", submittedAt: NOW - 31 * MIN }),
        attempt({ id: "w-old", submittedAt: NOW - 20 * MIN }),
        attempt({ id: "c-old", submittedAt: NOW - 90 * MIN }),
      ],
      mainnet,
    );
    expect(report.alerts.map((a) => a.attemptId)).toEqual(["c-old", "c-young", "w-old", "w-young"]);
    expect(report.counts).toEqual({ warning: 2, critical: 2, unknownOutcome: 4, networkMismatch: 0 });
    for (const alert of report.alerts) {
      expect(alert.sourceAccountMasked).toBe("GSOURC...ABCD");
    }
    expect(JSON.stringify(report)).not.toContain(SOURCE);
  });

  it("does not mutate its input", () => {
    const rows = [attempt({ submittedAt: NOW - 90 * MIN })];
    const snapshot = JSON.stringify(rows);
    buildPendingPayoutAlerts(rows, mainnet);
    expect(JSON.stringify(rows)).toBe(snapshot);
  });
});

describe("checkPendingPayoutAlerts", () => {
  it("only reads pending attempts and uses the configured network's thresholds", async () => {
    const find = vi.fn().mockResolvedValue([attempt({ submittedAt: NOW - 45 * MIN })]);
    const save = vi.fn();
    const update = vi.fn();
    const dataSource = { getRepository: vi.fn(() => ({ find, save, update })) } as unknown as DataSource;

    const report = await checkPendingPayoutAlerts(dataSource, {
      networkPassphrase: NETWORK_PASSPHRASES.mainnet,
      env: {},
      nowMs: NOW,
    });

    expect(find).toHaveBeenCalledWith({ where: { status: "pending" } });
    expect(save).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(report.network).toBe("mainnet");
    expect(report.alerts[0].severity).toBe("critical");
  });

  it("fails loudly on invalid threshold configuration before querying", async () => {
    const find = vi.fn();
    const dataSource = { getRepository: vi.fn(() => ({ find })) } as unknown as DataSource;
    await expect(
      checkPendingPayoutAlerts(dataSource, {
        networkPassphrase: NETWORK_PASSPHRASES.testnet,
        env: { PENDING_PAYOUT_ALERT_CRITICAL_MINUTES: "1" },
        nowMs: NOW,
      }),
    ).rejects.toThrow(PayoutAlertConfigurationError);
    expect(find).not.toHaveBeenCalled();
  });
});
