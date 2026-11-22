/**
 * Ledger entry balancing invariants (#1475).
 *
 * Defines and evaluates the accounting invariants that must hold across the
 * `transactions` (payout side) and `ledger_blocks` (settlement side) tables
 * for every supported split/payout transition. All checks are pure functions
 * over already-loaded rows — no database access, no clock, no I/O — so they
 * can be unit-tested exhaustively and reused by the operator tooling
 * (`scripts/reconcile-dry-run.ts`, #1477) without duplicating logic.
 *
 * ## Transitions modeled
 *
 * A payout moves through: (recorded `pending`) -> (`completed` | `failed`).
 * When the app observes an on-chain settlement, a `settlement`-type
 * `ledger_blocks` row exists for the same `txHash`. The invariants below pin
 * down what "balanced" means at every point of that lifecycle:
 *
 * | id       | invariant                                                          | severity |
 * |----------|--------------------------------------------------------------------|----------|
 * | INV-1    | every transaction amount and settlement amount is a valid,         | critical |
 * |          | non-negative decimal string with <= 7 fraction digits and value    |          |
 * |          | <= 2^127-1 (the DB check constraint, re-verified in process)       |          |
 * | INV-2    | a `completed` transaction (a payout that settled) has amount > 0   | critical |
 * | INV-3    | a `settlement` ledger entry matched to a completed transaction     | critical |
 * |          | carries exactly the same amount (canonical decimal equality)       |          |
 * | INV-4    | a `failed` transaction has no matching `settlement` ledger entry   | critical |
 * |          | (a payout that failed must not appear settled on-chain)            |          |
 * | INV-5    | settlement entries are unique per txHash (a payout settles at most  | critical |
 * |          | once) and aggregate conservation holds: total settled amount ==     |          |
 * |          | total completed payout amount (catches drift INV-3 cannot see,      |          |
 * |          | e.g. settlement rows whose transaction record is missing — the     |          |
 * |          | #937 orphan case)                                                  |          |
 *
 * Amount comparisons use the exact fixed-point helpers in
 * `lib/decimal-amounts.ts`; `Number()` is never used on an amount.
 *
 * Missing-counterpart detection (completed without settlement, settlement
 * without transaction) is deliberately NOT duplicated here — that is
 * `checkOrphanedTransactions()` (#937), which the dry-run command runs
 * alongside these invariants.
 */
import {
  addAmounts,
  AmountError,
  compareAmounts,
  isValidAmountString,
  isZeroAmount,
  sumAmounts,
  toUnits,
} from "../lib/decimal-amounts.js";
import type { TransactionRecord, TransactionStatus } from "../entities/Transaction.js";
import type { LedgerBlock } from "../entities/LedgerBlock.js";

export type InvariantSeverity = "critical" | "warning";

export interface InvariantViolation {
  /** Stable id, e.g. "INV-2-nonzero-completed-amount". */
  invariantId: string;
  severity: InvariantSeverity;
  message: string;
  /** The offending row's txHash, when the violation is row-scoped. */
  txHash?: string;
  /** The offending row's primary id, when known. */
  rowId?: string;
}

export interface RoundBalance {
  roundId: string;
  /** Σ completed transaction amounts (exact). */
  completedTotal: string;
  /** Σ amounts of matched settlement entries for this round (exact). */
  settledTotal: string;
  completedCount: number;
  settledCount: number;
}

export interface LedgerBalanceReport {
  /** True iff there are no violations at all. */
  balanced: boolean;
  violations: InvariantViolation[];
  /** Per-round conservation summary (completed vs settled totals). */
  rounds: RoundBalance[];
  totals: {
    transactionCount: number;
    settlementCount: number;
    completedTotal: string;
    settledTotal: string;
  };
}

function violation(
  invariantId: string,
  message: string,
  extra?: { txHash?: string; rowId?: string; severity?: InvariantSeverity }
): InvariantViolation {
  return {
    invariantId,
    severity: extra?.severity ?? "critical",
    message,
    ...(extra?.txHash !== undefined ? { txHash: extra.txHash } : {}),
    ...(extra?.rowId !== undefined ? { rowId: extra.rowId } : {}),
  };
}

/** Amounts stored on transactions are non-nullable strings; blocks are nullable. */
function blockAmount(block: LedgerBlock): string | undefined {
  return block.amount ?? undefined;
}

/**
 * Evaluates every invariant over the given rows and returns the full
 * report. Pure: the same inputs always produce the same report, and no
 * input is mutated.
 */
export function evaluateLedgerBalance(
  transactions: TransactionRecord[],
  ledgerBlocks: LedgerBlock[]
): LedgerBalanceReport {
  const violations: InvariantViolation[] = [];

  // Index settlement blocks by txHash. Duplicate txHashes among settlement
  // blocks would themselves be a duplication defect; flag it. Since #1641 the
  // partial unique index UQ_ledger_blocks_settlement_tx_hash prevents this on
  // migrated databases, but rows restored from older backups are still checked.
  const settlementByTxHash = new Map<string, LedgerBlock[]>();
  for (const block of ledgerBlocks) {
    if (block.type !== "settlement") continue;
    const list = settlementByTxHash.get(block.txHash) ?? [];
    list.push(block);
    settlementByTxHash.set(block.txHash, list);
  }
  for (const [txHash, blocks] of settlementByTxHash) {
    if (blocks.length > 1) {
      violations.push(
        violation(
          "INV-5-duplicate-settlement-entry",
          `${blocks.length} settlement ledger entries share txHash ${txHash}; a payout must settle at most once.`,
          { txHash, rowId: blocks[0].id }
        )
      );
    }
  }

  // --- INV-1: amount format on both sides -------------------------------
  for (const tx of transactions) {
    if (!isValidAmountString(tx.amount)) {
      violations.push(
        violation(
          "INV-1-invalid-amount-format",
          `Transaction amount ${JSON.stringify(tx.amount)} violates the ledger amount contract (non-negative decimal, <=7 fraction digits, <= 2^127-1).`,
          { txHash: tx.txHash, rowId: tx.id }
        )
      );
    }
  }
  for (const block of ledgerBlocks) {
    const amount = blockAmount(block);
    if (amount !== undefined && !isValidAmountString(amount)) {
      violations.push(
        violation(
          "INV-1-invalid-amount-format",
          `Ledger entry amount ${JSON.stringify(amount)} violates the ledger amount contract.`,
          { txHash: block.txHash, rowId: block.id }
        )
      );
    }
  }

  // --- INV-2 / INV-3 / INV-4: row-scoped transition invariants ----------
  const txByStatus = new Map<TransactionStatus, TransactionRecord[]>();
  for (const tx of transactions) {
    const list = txByStatus.get(tx.status) ?? [];
    list.push(tx);
    txByStatus.set(tx.status, list);
  }

  for (const tx of txByStatus.get("completed") ?? []) {
    if (!isValidAmountString(tx.amount)) continue; // INV-1 already flagged
    if (isZeroAmount(tx.amount)) {
      violations.push(
        violation(
          "INV-2-nonzero-completed-amount",
          `Completed transaction ${tx.txHash} has amount 0; a settled payout must move a positive amount.`,
          { txHash: tx.txHash, rowId: tx.id }
        )
      );
    }
  }

  for (const tx of transactions) {
    if (!isValidAmountString(tx.amount)) continue;
    const settlements = settlementByTxHash.get(tx.txHash) ?? [];
    const primary = settlements[0];
    if (!primary) continue; // missing counterpart is the #937 orphan check

    const settledAmount = blockAmount(primary);
    if (settledAmount === undefined || !isValidAmountString(settledAmount)) continue; // INV-1

    if (tx.status === "completed") {
      if (compareAmounts(tx.amount, settledAmount) !== 0) {
        violations.push(
          violation(
            "INV-3-amount-match",
            `Amount mismatch for settled payout ${tx.txHash}: transaction says ${tx.amount}, ledger entry says ${settledAmount}.`,
            { txHash: tx.txHash, rowId: tx.id }
          )
        );
      }
    } else if (tx.status === "failed") {
      violations.push(
        violation(
          "INV-4-failed-not-settled",
          `Transaction ${tx.txHash} is ${tx.status} but has a settlement ledger entry; a failed payout must not appear settled.`,
          { txHash: tx.txHash, rowId: tx.id }
        )
      );
    }
    // "pending" with a settlement entry is legitimate: the app has observed
    // the on-chain settle but has not yet flipped the row to completed.
    // Reconciliation of that lag is the aging report (#1476), not a
    // balancing violation.
  }

  // --- INV-5: aggregate conservation ------------------------------------
  const completedAmounts = (txByStatus.get("completed") ?? [])
    .filter((tx) => isValidAmountString(tx.amount))
    .map((tx) => tx.amount);
  let completedTotal: string;
  try {
    completedTotal = sumAmounts(completedAmounts);
  } catch (error) {
    completedTotal = "0";
    violations.push(
      violation(
        "INV-5-amount-overflow",
        `Summing completed payout amounts overflowed: ${error instanceof AmountError ? error.message : String(error)}`
      )
    );
  }

  const settledAmounts: string[] = [];
  for (const blocks of settlementByTxHash.values()) {
    const amount = blockAmount(blocks[0]);
    if (amount !== undefined && isValidAmountString(amount)) settledAmounts.push(amount);
  }
  let settledTotal: string;
  try {
    settledTotal = sumAmounts(settledAmounts);
  } catch (error) {
    settledTotal = "0";
    violations.push(
      violation(
        "INV-5-amount-overflow",
        `Summing settlement amounts overflowed: ${error instanceof AmountError ? error.message : String(error)}`
      )
    );
  }

  if (compareAmounts(completedTotal, settledTotal) !== 0) {
    violations.push(
      violation(
        "INV-5-aggregate-conservation",
        `Aggregate mismatch: completed payouts total ${completedTotal} but settlement entries total ${settledTotal}.`
      )
    );
  }

  // --- Per-round conservation summary (diagnostic, not a violation) -----
  // Accumulation overflow is already reported once above via INV-5; a round
  // whose running total overflows simply stops accumulating (its counts stay
  // accurate) instead of throwing a second time.
  const rounds = new Map<string, RoundBalance>();
  const accumulate = (
    roundId: string,
    side: "completedTotal" | "settledTotal",
    amount: string
  ): void => {
    const round = rounds.get(roundId) ?? {
      roundId,
      completedTotal: "0",
      settledTotal: "0",
      completedCount: 0,
      settledCount: 0,
    };
    try {
      round[side] = addAmounts(round[side], amount);
    } catch (error) {
      if (!(error instanceof AmountError)) throw error;
    }
    rounds.set(roundId, round);
  };
  for (const tx of transactions) {
    const round = rounds.get(tx.roundId) ?? {
      roundId: tx.roundId,
      completedTotal: "0",
      settledTotal: "0",
      completedCount: 0,
      settledCount: 0,
    };
    rounds.set(tx.roundId, round);
    if (tx.status === "completed" && isValidAmountString(tx.amount)) {
      round.completedCount += 1;
      accumulate(tx.roundId, "completedTotal", tx.amount);
    }
  }
  for (const [txHash, blocks] of settlementByTxHash) {
    const amount = blockAmount(blocks[0]);
    if (amount === undefined || !isValidAmountString(amount)) continue;
    const tx = transactions.find((t) => t.txHash === txHash);
    const roundId = tx?.roundId;
    if (!roundId) continue; // settlement without transaction: #937's job
    const round = rounds.get(roundId) ?? {
      roundId,
      completedTotal: "0",
      settledTotal: "0",
      completedCount: 0,
      settledCount: 0,
    };
    round.settledCount += 1;
    rounds.set(roundId, round);
    accumulate(roundId, "settledTotal", amount);
  }

  return {
    balanced: violations.length === 0,
    violations,
    rounds: Array.from(rounds.values()).sort((a, b) => a.roundId.localeCompare(b.roundId)),
    totals: {
      transactionCount: transactions.length,
      settlementCount: settledAmounts.length,
      completedTotal,
      settledTotal,
    },
  };
}

/** Convenience helper: exact sum of completed payout amounts, for callers that only need the total. */
export function totalCompletedAmount(transactions: TransactionRecord[]): string {
  return sumAmounts(
    transactions
      .filter((tx) => tx.status === "completed" && isValidAmountString(tx.amount))
      .map((tx) => tx.amount)
  );
}

/** Re-exported so callers can do exact threshold math on ledger amounts. */
export { toUnits };
