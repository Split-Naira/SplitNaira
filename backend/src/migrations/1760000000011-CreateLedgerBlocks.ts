import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * The LedgerBlock entity had no migration, so a freshly migrated database had
 * no ledger_blocks table (and AddFrequentQueryIndexes1760000000007 failed on it).
 * Everything here is IF NOT EXISTS so databases that already have the table
 * are unaffected.
 */
export class CreateLedgerBlocks1760000000011 implements MigrationInterface {
  name = "CreateLedgerBlocks1760000000011";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ledger_blocks_type_enum') THEN
          CREATE TYPE "public"."ledger_blocks_type_enum" AS ENUM ('settlement', 'milestone');
        END IF;
      END
      $$
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ledger_blocks" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "ledgerSeq" bigint NOT NULL,
        "txHash" character varying(128) NOT NULL,
        "type" "public"."ledger_blocks_type_enum" NOT NULL,
        "projectId" character varying(64),
        "recipient" character varying(128),
        "amount" character varying(64),
        "ledgerClosedAt" TIMESTAMPTZ NOT NULL,
        CONSTRAINT "PK_ledger_blocks_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_ledger_blocks_ledger_seq" ON "ledger_blocks" ("ledgerSeq")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_ledger_blocks_tx_hash" ON "ledger_blocks" ("txHash")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_ledger_blocks_project_id" ON "ledger_blocks" ("projectId")`);
  }

  // Never destroys data: the table is dropped only if it is empty.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('public.ledger_blocks') IS NOT NULL THEN
          IF NOT EXISTS (SELECT 1 FROM "ledger_blocks") THEN
            DROP TABLE "ledger_blocks";
            DROP TYPE IF EXISTS "public"."ledger_blocks_type_enum";
          END IF;
        END IF;
      END
      $$
    `);
  }
}