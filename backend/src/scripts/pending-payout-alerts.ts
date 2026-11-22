/**
 * Pending payout alert check (#1642).
 *
 * Read-only: loads `pending` rows from `transaction_attempts` and evaluates
 * them with services/pending-payout-alerts.ts using the thresholds of the
 * network this deployment is configured for (SOROBAN_NETWORK_PASSPHRASE).
 * It never changes an attempt's status and never recommends a retry.
 *
 * Exit code: 2 when any alert is critical, 1 when there are only warnings,
 * 0 otherwise — so it can gate a cron alert.
 *
 *   cd backend && npx tsx src/scripts/pending-payout-alerts.ts [--json]
 *
 * See docs/runbooks/stuck-payouts.md ("Network-aware pending payout alerts").
 */
import "reflect-metadata";
import { fileURLToPath } from "url";
import type { DataSource } from "typeorm";
import { TransactionAttempt } from "../entities/TransactionAttempt.js";
import { initDatabase, closeDatabase } from "../services/database.js";
import { logger } from "../services/logger.js";
import {
  buildPendingPayoutAlerts,
  exitCodeForPayoutAlerts,
  networkNameForPassphrase,
  resolvePayoutAlertThresholds,
  type PendingPayoutAlertReport,
} from "../services/pending-payout-alerts.js";

export async function checkPendingPayoutAlerts(
  dataSource: DataSource,
  options: {
    networkPassphrase: string;
    env?: Record<string, string | undefined>;
    nowMs?: number;
  },
): Promise<PendingPayoutAlertReport> {
  const thresholds = resolvePayoutAlertThresholds(
    networkNameForPassphrase(options.networkPassphrase),
    options.env ?? process.env,
  );
  const pending = await dataSource
    .getRepository(TransactionAttempt)
    .find({ where: { status: "pending" } });
  return buildPendingPayoutAlerts(pending, {
    networkPassphrase: options.networkPassphrase,
    nowMs: options.nowMs ?? Date.now(),
    thresholds,
  });
}

function printReport(report: PendingPayoutAlertReport): void {
  logger.info("Pending payout alert check", {
    network: report.network,
    thresholdsMinutes: report.thresholds,
    totalPending: report.totalPending,
    ...report.counts,
  });
  for (const warning of report.warnings) logger.warn(warning);
  for (const alert of report.alerts) {
    const line =
      `[${alert.severity}] txHash=${alert.txHash} project=${alert.projectId} source=${alert.sourceAccountMasked} ` +
      `network=${alert.network} ageMinutes=${alert.ageMinutes} outcome=${alert.outcome} ` +
      `action=${alert.recommendedAction} retrySafe=${alert.retrySafe}`;
    if (alert.severity === "critical") logger.error(line);
    else logger.warn(line);
  }
}

async function runCli(): Promise<number> {
  const networkPassphrase = process.env.SOROBAN_NETWORK_PASSPHRASE;
  if (!networkPassphrase) {
    logger.error("SOROBAN_NETWORK_PASSPHRASE is required to choose alert thresholds");
    return 2;
  }

  let dataSource: DataSource;
  try {
    dataSource = await initDatabase();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Failed to connect to the database", { error: message });
    return 2;
  }

  try {
    const report = await checkPendingPayoutAlerts(dataSource, { networkPassphrase });
    if (process.argv.includes("--json")) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      printReport(report);
    }
    return exitCodeForPayoutAlerts(report);
  } finally {
    await closeDatabase();
  }
}

const __filename = fileURLToPath(import.meta.url);
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("pending-payout-alerts.ts") ||
    process.argv[1].endsWith("pending-payout-alerts.js") ||
    process.argv[1] === __filename);

if (isDirectRun) {
  runCli()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Unexpected error running pending payout alert check", { error: message });
      process.exitCode = 2;
    });
}
