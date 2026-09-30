import { MigrationInterface, QueryRunner } from "typeorm";

export class AddFrequentQueryIndexes1760000000007 implements MigrationInterface {
  name = "AddFrequentQueryIndexes1760000000007";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE INDEX "IDX_users_email" ON "users" ("email")`);
    await queryRunner.query(`CREATE INDEX "IDX_transactions_recipient_timestamp" ON "transactions" ("recipient", "timestamp")`);
    // ledger_blocks is created by CreateLedgerBlocks1760000000011, which runs
    // after this migration on a fresh database, so only index it when it exists.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('public.ledger_blocks') IS NOT NULL THEN
          CREATE INDEX IF NOT EXISTS "IDX_ledger_blocks_project_id" ON "ledger_blocks" ("projectId");
        END IF;
      END
      $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_ledger_blocks_project_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_transactions_recipient_timestamp"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_users_email"`);
  }
}