/**
 * Database consistency audit command (#1338).
 *
 * Runs a set of independent relational-invariant checks against the
 * database and produces one consolidated report:
 *
 *   1. Transaction <-> ledger_blocks reconciliation (reuses the existing,
 *      already-tested `checkOrphanedTransactions()` from
 *      `check-orphaned-transactions.ts` (#937) rather than duplicating it).
 *   2. Uniqueness invariants that the app relies on elsewhere, re-verified
 *      independently of whatever database constraint currently backs them
 *      (constraints can be missing on a not-fully-migrated database, or
 *      bypassed by a manual/raw write):
 *        - `users.walletAddress`
 *        - `transactions.txHash`
 *        - `notifications.eventKey`
 *        - `notification_preferences` (wallet, category)
 *        - `split_cancellations.projectId`
 *   3. A business invariant specific to this schema: a `security` or
 *      `payment` notification preference must never be disabled (see
 *      `entities/NotificationPreference.ts`).
 *
 * This project's entities have no real foreign keys (see the header comment
 * in `check-orphaned-transactions.ts` for why) so "relational invariant"
 * here means cross-table reconciliation and uniqueness, not FK integrity.
 *
 * Output: a human-readable report via `logger` by default, or a single JSON
 * document on stdout with `--json` (for scripting / machine consumption).
 * See docs/database-consistency-audit.md for the full writeup.
 *
 * Run standalone:
 *   cd backend && npx tsx src/scripts/audit-database-consistency.ts
 *   cd backend && npx tsx src/scripts/audit-database-consistency.ts --json
 *
 * Exit code is 1 if any finding has severity "critical", 0 otherwise.
 */
import "reflect-metadata";
import { fileURLToPath } from "url";
import type { DataSource } from "typeorm";
import {
  checkOrphanedTransactions,
  maskWalletAddress,
  sanitizeErrorMessage,
  LEDGER_BLOCKS_MISSING_WARNING,
} from "./check-orphaned-transactions.js";
import { User } from "../entities/User.js";
import { TransactionRecord } from "../entities/Transaction.js";
import { Notification } from "../entities/Notification.js";
import {
  NotificationPreference,
  isMandatoryCategory,
} from "../entities/NotificationPreference.js";
import { SplitCancellation } from "../entities/SplitCancellation.js";
import { initDatabase, closeDatabase } from "../services/database.js";
import { logger } from "../services/logger.js";

export type FindingSeverity = "critical" | "warning";

export interface ConsistencyFinding {
  /** Stable id for the check that produced this finding, e.g. "duplicate-wallet-address". */
  checkId: string;
  severity: FindingSeverity;
  /** Human-readable summary of what was found. */
  message: string;
  /** Number of affected rows/keys, when the finding is a count of something. */
  count?: number;
  /** A small (max 5), possibly-masked sample of affected identifiers. */
  sampleIds?: string[];
}

export interface ConsistencyAuditReport {
  generatedAt: string;
  checksRun: string[];
  findings: ConsistencyFinding[];
  /** True iff no finding has severity "critical". */
  ok: boolean;
}

const SAMPLE_LIMIT = 5;

/** Returns the values that appear more than once in `values`, each once. */
function findDuplicateValues(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    } else {
      seen.add(value);
    }
  }
  return Array.from(duplicates);
}

/**
 * Translates the existing orphaned-transactions report (#937) into
 * consistency findings, so this audit doesn't re-implement that
 * reconciliation logic.
 */
async function runOrphanedTransactionsCheck(
  dataSource: DataSource
): Promise<ConsistencyFinding[]> {
  const checkId = "transaction-ledger-reconciliation";
  const report = await checkOrphanedTransactions(dataSource);
  const findings: ConsistencyFinding[] = [];

  if (report.completedTransactionsMissingLedgerBlock.length > 0) {
    findings.push({
      checkId,
      severity: "critical",
      message: `${report.completedTransactionsMissingLedgerBlock.length} completed transaction(s) have no matching ledger_blocks settlement record.`,
      count: report.completedTransactionsMissingLedgerBlock.length,
      sampleIds: report.completedTransactionsMissingLedgerBlock
        .slice(0, SAMPLE_LIMIT)
        .map((t) => t.txHash),
    });
  }

  if (report.settlementLedgerBlocksMissingTransaction.length > 0) {
    findings.push({
      checkId,
      severity: "critical",
      message: `${report.settlementLedgerBlocksMissingTransaction.length} settlement ledger_blocks row(s) have no matching transactions row.`,
      count: report.settlementLedgerBlocksMissingTransaction.length,
      sampleIds: report.settlementLedgerBlocksMissingTransaction
        .slice(0, SAMPLE_LIMIT)
        .map((b) => b.txHash),
    });
  }

  if (!report.ledgerBlocksTableAvailable) {
    findings.push({ checkId, severity: "warning", message: LEDGER_BLOCKS_MISSING_WARNING });
  }

  if (report.unregisteredRecipients.count > 0) {
    findings.push({
      checkId,
      severity: "warning",
      message: `${report.unregisteredRecipients.count} distinct recipient wallet(s) referenced in transactions/ledger_blocks are not registered users (expected; informational only).`,
      count: report.unregisteredRecipients.count,
      sampleIds: report.unregisteredRecipients.sampleMasked,
    });
  }

  return findings;
}

async function checkDuplicateWalletAddresses(
  dataSource: DataSource
): Promise<ConsistencyFinding[]> {
  const users = await dataSource.getRepository(User).find();
  const duplicates = findDuplicateValues(users.map((u) => u.walletAddress));
  if (duplicates.length === 0) return [];
  return [
    {
      checkId: "duplicate-wallet-address",
      severity: "critical",
      message: `${duplicates.length} wallet address(es) are registered on more than one users row.`,
      count: duplicates.length,
      sampleIds: duplicates.slice(0, SAMPLE_LIMIT).map(maskWalletAddress),
    },
  ];
}

async function checkDuplicateTransactionHashes(
  dataSource: DataSource
): Promise<ConsistencyFinding[]> {
  const transactions = await dataSource.getRepository(TransactionRecord).find();
  const duplicates = findDuplicateValues(transactions.map((t) => t.txHash));
  if (duplicates.length === 0) return [];
  return [
    {
      checkId: "duplicate-transaction-hash",
      severity: "critical",
      message: `${duplicates.length} txHash value(s) appear on more than one transactions row.`,
      count: duplicates.length,
      sampleIds: duplicates.slice(0, SAMPLE_LIMIT),
    },
  ];
}

async function checkDuplicateNotificationEventKeys(
  dataSource: DataSource
): Promise<ConsistencyFinding[]> {
  const notifications = await dataSource.getRepository(Notification).find();
  const duplicates = findDuplicateValues(notifications.map((n) => n.eventKey));
  if (duplicates.length === 0) return [];
  return [
    {
      checkId: "duplicate-notification-event-key",
      severity: "critical",
      message: `${duplicates.length} notification eventKey value(s) appear on more than one row, breaking the delivery-idempotency guarantee.`,
      count: duplicates.length,
      sampleIds: duplicates.slice(0, SAMPLE_LIMIT),
    },
  ];
}

async function checkDuplicateNotificationPreferences(
  dataSource: DataSource
): Promise<ConsistencyFinding[]> {
  const preferences = await dataSource.getRepository(NotificationPreference).find();
  const duplicates = findDuplicateValues(preferences.map((p) => `${p.wallet}::${p.category}`));
  if (duplicates.length === 0) return [];
  return [
    {
      checkId: "duplicate-notification-preference",
      severity: "critical",
      message: `${duplicates.length} (wallet, category) pair(s) have more than one notification_preferences row, which can produce contradictory preferences.`,
      count: duplicates.length,
      sampleIds: duplicates.slice(0, SAMPLE_LIMIT).map((key) => {
        const [wallet, category] = key.split("::");
        return `${maskWalletAddress(wallet)}::${category}`;
      }),
    },
  ];
}

async function checkDuplicateSplitCancellationProjects(
  dataSource: DataSource
): Promise<ConsistencyFinding[]> {
  const cancellations = await dataSource.getRepository(SplitCancellation).find();
  const duplicates = findDuplicateValues(cancellations.map((c) => c.projectId));
  if (duplicates.length === 0) return [];
  return [
    {
      checkId: "duplicate-split-cancellation-project",
      severity: "critical",
      message: `${duplicates.length} project id(s) have more than one split_cancellations row (a split may only be cancelled once).`,
      count: duplicates.length,
      sampleIds: duplicates.slice(0, SAMPLE_LIMIT),
    },
  ];
}

async function checkMandatoryPreferencesNotDisabled(
  dataSource: DataSource
): Promise<ConsistencyFinding[]> {
  const preferences = await dataSource.getRepository(NotificationPreference).find();
  const violations = preferences.filter((p) => isMandatoryCategory(p.category) && !p.enabled);
  if (violations.length === 0) return [];
  return [
    {
      checkId: "mandatory-notification-preference-disabled",
      severity: "critical",
      message: `${violations.length} notification_preferences row(s) disable a mandatory category (security/payment), which must never be silenced.`,
      count: violations.length,
      sampleIds: violations
        .slice(0, SAMPLE_LIMIT)
        .map((p) => `${maskWalletAddress(p.wallet)}::${p.category}`),
    },
  ];
}

/**
 * Runs every consistency check and returns one consolidated report.
 * Exported so it can be exercised directly in tests against a mocked
 * DataSource, the same way `checkOrphanedTransactions()` is.
 */
export async function runDatabaseConsistencyAudit(
  dataSource: DataSource
): Promise<ConsistencyAuditReport> {
  const checks: Array<[string, () => Promise<ConsistencyFinding[]>]> = [
    ["transaction-ledger-reconciliation", () => runOrphanedTransactionsCheck(dataSource)],
    ["duplicate-wallet-address", () => checkDuplicateWalletAddresses(dataSource)],
    ["duplicate-transaction-hash", () => checkDuplicateTransactionHashes(dataSource)],
    ["duplicate-notification-event-key", () => checkDuplicateNotificationEventKeys(dataSource)],
    ["duplicate-notification-preference", () => checkDuplicateNotificationPreferences(dataSource)],
    [
      "duplicate-split-cancellation-project",
      () => checkDuplicateSplitCancellationProjects(dataSource),
    ],
    [
      "mandatory-notification-preference-disabled",
      () => checkMandatoryPreferencesNotDisabled(dataSource),
    ],
  ];

  const checksRun: string[] = [];
  const findings: ConsistencyFinding[] = [];

  for (const [checkId, run] of checks) {
    checksRun.push(checkId);
    findings.push(...(await run()));
  }

  return {
    generatedAt: new Date().toISOString(),
    checksRun,
    findings,
    ok: !findings.some((f) => f.severity === "critical"),
  };
}

function printHumanReadableReport(report: ConsistencyAuditReport): void {
  const criticalCount = report.findings.filter((f) => f.severity === "critical").length;
  const warningCount = report.findings.length - criticalCount;

  logger.info("Database consistency audit summary", {
    checksRun: report.checksRun,
    criticalFindings: criticalCount,
    warningFindings: warningCount,
    ok: report.ok,
  });

  for (const finding of report.findings) {
    const log = finding.severity === "critical" ? logger.error : logger.warn;
    log(`[${finding.checkId}] ${finding.message}`, {
      severity: finding.severity,
      count: finding.count,
      sample: finding.sampleIds,
    });
  }

  if (report.ok) {
    logger.info("No critical discrepancies found.");
  }
}

async function runCli(): Promise<number> {
  const jsonOutput = process.argv.includes("--json");

  let dataSource: DataSource;
  try {
    dataSource = await initDatabase();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const sanitized = sanitizeErrorMessage(message);
    if (jsonOutput) {
      console.log(JSON.stringify({ ok: false, error: sanitized }));
    } else {
      logger.error("Failed to connect to the database", { error: sanitized });
    }
    return 1;
  }

  try {
    const report = await runDatabaseConsistencyAudit(dataSource);
    if (jsonOutput) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printHumanReadableReport(report);
    }
    return report.ok ? 0 : 1;
  } finally {
    await closeDatabase();
  }
}

const __filename = fileURLToPath(import.meta.url);
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("audit-database-consistency.ts") ||
    process.argv[1].endsWith("audit-database-consistency.js") ||
    process.argv[1] === __filename);

if (isDirectRun) {
  runCli()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Unexpected error running database consistency audit", {
        error: sanitizeErrorMessage(message),
      });
      process.exitCode = 1;
    });
}