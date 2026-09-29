import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * AddImmutableTransactionRecords1760000000008
 *
 * Makes the `transactions` table an append-only financial record (#1339).
 *
 * Immutable after insert: id, roundId, recipient, amount, token, timestamp,
 * txHash. Only `status` may change (pending -> completed/failed). Rows cannot
 * be deleted.
 *
 * Enforced with a row-level trigger rather than application code so that ad-hoc
 * SQL, scripts and future code paths are covered too. The trigger only rejects
 * updates that actually change a protected value, so the event listener's
 * `upsert` of an identical row keeps working.
 */
export class AddImmutableTransactionRecords1760000000008
  implements MigrationInterface
{
  name = "AddImmutableTransactionRecords1760000000008";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "prevent_transaction_record_mutation"()
      RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'transactions rows are immutable and cannot be deleted (id=%)', OLD."id"
            USING ERRCODE = 'integrity_constraint_violation';
        END IF;

        IF NEW."id" IS DISTINCT FROM OLD."id" THEN
          RAISE EXCEPTION 'transactions.id is immutable'
            USING ERRCODE = 'integrity_constraint_violation';
        END IF;
        IF NEW."roundId" IS DISTINCT FROM OLD."roundId" THEN
          RAISE EXCEPTION 'transactions.roundId is immutable'
            USING ERRCODE = 'integrity_constraint_violation';
        END IF;
        IF NEW."recipient" IS DISTINCT FROM OLD."recipient" THEN
          RAISE EXCEPTION 'transactions.recipient is immutable'
            USING ERRCODE = 'integrity_constraint_violation';
        END IF;
        IF NEW."amount" IS DISTINCT FROM OLD."amount" THEN
          RAISE EXCEPTION 'transactions.amount is immutable'
            USING ERRCODE = 'integrity_constraint_violation';
        END IF;
        IF NEW."token" IS DISTINCT FROM OLD."token" THEN
          RAISE EXCEPTION 'transactions.token is immutable'
            USING ERRCODE = 'integrity_constraint_violation';
        END IF;
        IF NEW."timestamp" IS DISTINCT FROM OLD."timestamp" THEN
          RAISE EXCEPTION 'transactions.timestamp is immutable'
            USING ERRCODE = 'integrity_constraint_violation';
        END IF;
        IF NEW."txHash" IS DISTINCT FROM OLD."txHash" THEN
          RAISE EXCEPTION 'transactions.txHash is immutable'
            USING ERRCODE = 'integrity_constraint_violation';
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    await queryRunner.query(`
      CREATE TRIGGER "trg_transactions_immutable"
      BEFORE UPDATE OR DELETE ON "transactions"
      FOR EACH ROW EXECUTE FUNCTION "prevent_transaction_record_mutation"()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_transactions_immutable" ON "transactions"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "prevent_transaction_record_mutation"()`,
    );
  }
}