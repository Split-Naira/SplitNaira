import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Issue #1641: a payout settles on-chain at most once, so `ledger_blocks` may
 * hold at most one `settlement` row per `txHash` (invariant INV-5 in
 * services/ledger-invariants.ts). Until now that was only detected after the
 * fact by the reconciliation tooling; two concurrent writers could both insert
 * a settlement for the same transaction because `IDX_ledger_blocks_tx_hash` is
 * a plain (non-unique) index.
 *
 * This adds a partial unique index so the database itself rejects the second
 * write with SQLSTATE 23505. It is partial (`WHERE type = 'settlement'`)
 * because `milestone` rows legitimately reference the same transaction.
 *
 * The migration refuses to run over existing duplicates instead of deleting
 * them: ledger_blocks is append-only financial history, so duplicates must be
 * reviewed by an operator (see docs/ledger-entry-balancing-invariants.md).
 */
export class AddLedgerSettlementTxHashUniqueness1760000000018 implements MigrationInterface {
  name = "AddLedgerSettlementTxHashUniqueness1760000000018";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const duplicates = (await queryRunner.query(`
      SELECT "txHash", count(*)::int AS "n"
      FROM "ledger_blocks"
      WHERE "type" = 'settlement'
      GROUP BY "txHash"
      HAVING count(*) > 1
      LIMIT 5
    `)) as Array<{ txHash: string; n: number }>;

    if (duplicates.length > 0) {
      const sample = duplicates.map((d) => `${d.txHash} (${d.n} rows)`).join(", ");
      throw new Error(
        `Cannot enforce one settlement per txHash: duplicate settlement ledger entries exist (${sample}). ` +
          "Resolve them with the reconciliation dry-run before re-running this migration.",
      );
    }

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_ledger_blocks_settlement_tx_hash" ON "ledger_blocks" ("txHash") WHERE "type" = 'settlement'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."UQ_ledger_blocks_settlement_tx_hash"`);
  }
}
