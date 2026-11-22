/**
 * Network-aware alerts for aging pending payouts (#1642).
 *
 * `transaction_attempts` rows (see services/transaction-recovery.ts) record
 * every submitted payout together with the network it was submitted to. This
 * module turns the still-`pending` attempts into operator alerts whose
 * thresholds depend on that network: a mainnet payout that has not resolved
 * after a few minutes is an incident, while the same delay on testnet is
 * routine.
 *
 * ## Unknown outcomes are never "failed" and never "safe to retry"
 *
 * A pending attempt only becomes `failed` through `decideRecoveryStatus`,
 * i.e. after the network has positively reported FAILED, or reported
 * NOT_FOUND after the submission validity window (`SUBMISSION_EXPIRY_MS`)
 * has passed. Anything else is an *unknown outcome*: the transaction may
 * still be in the mempool, may already be in a ledger the RPC has not
 * indexed, or the RPC may simply be unreachable. Re-submitting a payout with
 * an unknown outcome risks paying twice, so every alert produced here has
 * `retrySafe: false` and a "verify on chain" action. This module never
 * mutates attempt status; it only reads.
 *
 * ## Outcome classes
 *
 * | outcome              | meaning                                                                  |
 * |----------------------|--------------------------------------------------------------------------|
 * | `in_flight`          | still inside the validity window; may legitimately land                  |
 * | `unknown`            | validity window elapsed but no post-expiry observation proves the result |
 * | `network_mismatch`   | submitted to a different network than this deployment watches            |
 *
 * ## Severity
 *
 * `age = now - submittedAt`. Severity is `critical` at or above the
 * network's critical threshold, `warning` at or above its warning threshold,
 * otherwise no alert. Two escalations apply regardless of age band:
 * an `unknown` outcome is at least `warning` (the window is over and nobody
 * has confirmed the result), and a `network_mismatch` is always `warning` —
 * this deployment's RPC cannot observe it, so its age says nothing.
 */
import type { TransactionAttempt } from "../entities/TransactionAttempt.js";
import { SUBMISSION_EXPIRY_MS } from "./transaction-recovery.js";

export const NETWORK_PASSPHRASES = {
  mainnet: "Public Global Stellar Network ; September 2015",
  testnet: "Test SDF Network ; September 2015",
  futurenet: "Test SDF Future Network ; October 2022",
} as const;

export type StellarNetworkName = keyof typeof NETWORK_PASSPHRASES | "custom";

export interface PayoutAlertThresholds {
  /** Minutes after submission at which a pending payout raises a warning. */
  warningMinutes: number;
  /** Minutes after submission at which a pending payout is critical. */
  criticalMinutes: number;
}

/**
 * Defaults per network. Mainnet moves real funds, so it pages fastest; test
 * networks are reset and congested often enough that tighter thresholds would
 * only produce noise. Unknown (custom/standalone) networks use the testnet
 * profile.
 */
export const DEFAULT_PAYOUT_ALERT_THRESHOLDS: Record<StellarNetworkName, PayoutAlertThresholds> = {
  mainnet: { warningMinutes: 10, criticalMinutes: 30 },
  testnet: { warningMinutes: 30, criticalMinutes: 120 },
  futurenet: { warningMinutes: 60, criticalMinutes: 360 },
  custom: { warningMinutes: 30, criticalMinutes: 120 },
};

export type PayoutAlertSeverity = "warning" | "critical";
export type PayoutOutcome = "in_flight" | "unknown" | "network_mismatch";
export type PayoutAlertAction = "monitor" | "verify_on_chain" | "investigate_network_mismatch";

export interface PendingPayoutAlert {
  attemptId: string;
  txHash: string;
  projectId: string;
  sourceAccountMasked: string;
  network: StellarNetworkName;
  ageMinutes: number;
  severity: PayoutAlertSeverity;
  outcome: PayoutOutcome;
  /** Always false: a pending payout's outcome is not known to be a failure. */
  retrySafe: false;
  recommendedAction: PayoutAlertAction;
  reason: string;
}

export interface PendingPayoutAlertReport {
  generatedAt: string;
  network: StellarNetworkName;
  thresholds: PayoutAlertThresholds;
  totalPending: number;
  counts: { warning: number; critical: number; unknownOutcome: number; networkMismatch: number };
  /** Sorted critical first, then oldest first. */
  alerts: PendingPayoutAlert[];
  warnings: string[];
}

export class PayoutAlertConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayoutAlertConfigurationError";
  }
}

export function networkNameForPassphrase(passphrase: string): StellarNetworkName {
  for (const [name, value] of Object.entries(NETWORK_PASSPHRASES)) {
    if (value === passphrase) return name as StellarNetworkName;
  }
  return "custom";
}

/**
 * Resolves the thresholds for the deployment's network. Env overrides
 * (`PENDING_PAYOUT_ALERT_WARNING_MINUTES`, `PENDING_PAYOUT_ALERT_CRITICAL_MINUTES`)
 * replace the network default; invalid values throw rather than being
 * silently repaired, because a wrong alert threshold is worse than none.
 */
export function resolvePayoutAlertThresholds(
  network: StellarNetworkName,
  env: Record<string, string | undefined> = process.env,
): PayoutAlertThresholds {
  const defaults = DEFAULT_PAYOUT_ALERT_THRESHOLDS[network];
  const parse = (raw: string | undefined, fallback: number, name: string): number => {
    if (raw === undefined || raw.trim() === "") return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      throw new PayoutAlertConfigurationError(
        `${name} must be a positive number of minutes, got ${JSON.stringify(raw)}`,
      );
    }
    return value;
  };
  const warningMinutes = parse(
    env.PENDING_PAYOUT_ALERT_WARNING_MINUTES,
    defaults.warningMinutes,
    "PENDING_PAYOUT_ALERT_WARNING_MINUTES",
  );
  const criticalMinutes = parse(
    env.PENDING_PAYOUT_ALERT_CRITICAL_MINUTES,
    defaults.criticalMinutes,
    "PENDING_PAYOUT_ALERT_CRITICAL_MINUTES",
  );
  if (criticalMinutes <= warningMinutes) {
    throw new PayoutAlertConfigurationError(
      `PENDING_PAYOUT_ALERT_CRITICAL_MINUTES (${criticalMinutes}) must be greater than ` +
        `PENDING_PAYOUT_ALERT_WARNING_MINUTES (${warningMinutes})`,
    );
  }
  // The validity window is when an outcome *can* first become known; a
  // warning threshold inside it would page on payouts that are simply in flight.
  const windowMinutes = SUBMISSION_EXPIRY_MS / 60_000;
  if (warningMinutes < windowMinutes) {
    throw new PayoutAlertConfigurationError(
      `PENDING_PAYOUT_ALERT_WARNING_MINUTES (${warningMinutes}) must be at least the ` +
        `${windowMinutes}-minute submission validity window`,
    );
  }
  return { warningMinutes, criticalMinutes };
}

function maskAccount(account: string): string {
  if (!account) return "(none)";
  if (account.length <= 10) return account;
  return `${account.slice(0, 6)}...${account.slice(-4)}`;
}

/**
 * The outcome of a pending attempt, judged only from what has been observed.
 * An attempt past the validity window is `unknown` until an observation taken
 * *after* the window proves otherwise — and such an observation would already
 * have moved it out of `pending` (see decideRecoveryStatus).
 */
export function classifyPendingOutcome(
  attempt: Pick<TransactionAttempt, "networkPassphrase" | "submittedAt">,
  currentPassphrase: string,
  nowMs: number,
): PayoutOutcome {
  if (attempt.networkPassphrase !== currentPassphrase) return "network_mismatch";
  if (nowMs - attempt.submittedAt < SUBMISSION_EXPIRY_MS) return "in_flight";
  return "unknown";
}

function severityForAge(
  ageMinutes: number,
  thresholds: PayoutAlertThresholds,
): PayoutAlertSeverity | null {
  if (ageMinutes >= thresholds.criticalMinutes) return "critical";
  if (ageMinutes >= thresholds.warningMinutes) return "warning";
  return null;
}

export function buildPendingPayoutAlerts(
  attempts: TransactionAttempt[],
  options: { networkPassphrase: string; nowMs: number; thresholds?: PayoutAlertThresholds },
): PendingPayoutAlertReport {
  const network = networkNameForPassphrase(options.networkPassphrase);
  const thresholds = options.thresholds ?? DEFAULT_PAYOUT_ALERT_THRESHOLDS[network];
  const warnings: string[] = [];
  const alerts: PendingPayoutAlert[] = [];
  let totalPending = 0;

  for (const attempt of attempts) {
    if (attempt.status !== "pending") continue; // resolved attempts never alert
    totalPending += 1;

    let ageMs = options.nowMs - attempt.submittedAt;
    if (ageMs < 0) {
      warnings.push(
        `Payout attempt ${attempt.txHash} has submittedAt in the future (skew ${Math.ceil(-ageMs / 1000)}s); treated as age 0.`,
      );
      ageMs = 0;
    }
    const ageMinutes = ageMs / 60_000;
    const outcome = classifyPendingOutcome(
      { networkPassphrase: attempt.networkPassphrase, submittedAt: options.nowMs - ageMs },
      options.networkPassphrase,
      options.nowMs,
    );

    let severity: PayoutAlertSeverity | null;
    let recommendedAction: PayoutAlertAction;
    let reason: string;
    const attemptNetwork = networkNameForPassphrase(attempt.networkPassphrase);

    if (outcome === "network_mismatch") {
      severity = "warning";
      recommendedAction = "investigate_network_mismatch";
      reason =
        `Submitted to ${attemptNetwork} but this deployment watches ${network}; ` +
        "its outcome cannot be observed here. Do not retry until it is checked on its own network.";
    } else {
      severity = severityForAge(ageMinutes, thresholds);
      if (outcome === "unknown") {
        severity = severity ?? "warning";
        recommendedAction = "verify_on_chain";
        reason =
          "Validity window elapsed without a post-expiry observation; the outcome is unknown. " +
          "Look the txHash up on chain before any retry — it may already have settled.";
      } else {
        recommendedAction = "monitor";
        reason = "Still inside its submission validity window; it may yet be included in a ledger.";
      }
    }

    if (severity === null) continue;
    alerts.push({
      attemptId: attempt.id,
      txHash: attempt.txHash,
      projectId: attempt.projectId,
      sourceAccountMasked: maskAccount(attempt.sourceAccount),
      network: attemptNetwork,
      ageMinutes: Math.round(ageMinutes * 100) / 100,
      severity,
      outcome,
      retrySafe: false,
      recommendedAction,
      reason,
    });
  }

  alerts.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "critical" ? -1 : 1;
    return b.ageMinutes - a.ageMinutes;
  });

  return {
    generatedAt: new Date(options.nowMs).toISOString(),
    network,
    thresholds,
    totalPending,
    counts: {
      warning: alerts.filter((a) => a.severity === "warning").length,
      critical: alerts.filter((a) => a.severity === "critical").length,
      unknownOutcome: alerts.filter((a) => a.outcome === "unknown").length,
      networkMismatch: alerts.filter((a) => a.outcome === "network_mismatch").length,
    },
    alerts,
    warnings,
  };
}

/** Exit code for cron/alert gating: 2 critical, 1 warning, 0 quiet. */
export function exitCodeForPayoutAlerts(report: PendingPayoutAlertReport): 0 | 1 | 2 {
  if (report.counts.critical > 0) return 2;
  if (report.counts.warning > 0) return 1;
  return 0;
}
