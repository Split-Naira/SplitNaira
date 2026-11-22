/**
 * Idempotent writer for `settlement` ledger entries (#1641).
 *
 * A payout settles on-chain at most once, so there is at most one
 * `settlement` row per `txHash`. The database enforces that with the partial
 * unique index `UQ_ledger_blocks_settlement_tx_hash`; this helper turns the
 * resulting unique violation (SQLSTATE 23505) into an idempotent outcome:
 *
 * - the first writer inserts the row (`created: true`);
 * - any concurrent or repeated writer with the *same* settlement gets the
 *   existing row back (`created: false`) instead of an error;
 * - a writer whose settlement disagrees with the stored one (different
 *   amount, recipient, project or ledger) gets `SettlementConflictError` —
 *   it is never silently merged, because that would hide an accounting drift.
 */
import type { DataSource } from "typeorm";
import { LedgerBlock } from "../entities/LedgerBlock.js";
import { compareAmounts, isValidAmountString } from "../lib/decimal-amounts.js";

export const SETTLEMENT_UNIQUE_INDEX = "UQ_ledger_blocks_settlement_tx_hash";

export interface SettlementInput {
  txHash: string;
  ledgerSeq: number;
  ledgerClosedAt: Date;
  projectId?: string;
  recipient?: string;
  amount: string;
}

export interface SettlementWriteResult {
  block: LedgerBlock;
  created: boolean;
}

export class SettlementConflictError extends Error {
  constructor(
    public readonly txHash: string,
    public readonly field: string,
  ) {
    super(`A different settlement is already recorded for txHash ${txHash} (field: ${field}).`);
    this.name = "SettlementConflictError";
  }
}

function isUniqueViolation(error: unknown): boolean {
  const err = error as { code?: unknown; driverError?: { code?: unknown } };
  return err.code === "23505" || err.driverError?.code === "23505";
}

function assertSameSettlement(existing: LedgerBlock, input: SettlementInput): void {
  if (Number(existing.ledgerSeq) !== input.ledgerSeq) {
    throw new SettlementConflictError(input.txHash, "ledgerSeq");
  }
  if ((existing.projectId ?? undefined) !== input.projectId) {
    throw new SettlementConflictError(input.txHash, "projectId");
  }
  if ((existing.recipient ?? undefined) !== input.recipient) {
    throw new SettlementConflictError(input.txHash, "recipient");
  }
  const stored = existing.amount ?? undefined;
  if (stored === undefined || !isValidAmountString(stored) || compareAmounts(stored, input.amount) !== 0) {
    throw new SettlementConflictError(input.txHash, "amount");
  }
}

async function findSettlement(dataSource: DataSource, txHash: string): Promise<LedgerBlock | null> {
  return dataSource.getRepository(LedgerBlock).findOneBy({ txHash, type: "settlement" });
}

/**
 * Records a settlement exactly once per txHash. Safe to call concurrently
 * from several processes: the database index arbitrates the race.
 */
export async function recordSettlement(
  dataSource: DataSource,
  input: SettlementInput,
): Promise<SettlementWriteResult> {
  if (!isValidAmountString(input.amount)) {
    throw new Error(`Settlement amount ${JSON.stringify(input.amount)} is not a valid ledger amount.`);
  }

  const existing = await findSettlement(dataSource, input.txHash);
  if (existing) {
    assertSameSettlement(existing, input);
    return { block: existing, created: false };
  }

  try {
    await dataSource.getRepository(LedgerBlock).insert({
      txHash: input.txHash,
      ledgerSeq: input.ledgerSeq,
      ledgerClosedAt: input.ledgerClosedAt,
      projectId: input.projectId,
      recipient: input.recipient,
      amount: input.amount,
      type: "settlement",
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Lost the race: another writer committed the settlement first.
    const raced = await findSettlement(dataSource, input.txHash);
    if (!raced) throw error;
    assertSameSettlement(raced, input);
    return { block: raced, created: false };
  }

  const created = await findSettlement(dataSource, input.txHash);
  if (!created) {
    throw new Error("Settlement was inserted but could not be read back.");
  }
  return { block: created, created: true };
}
