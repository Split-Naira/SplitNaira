import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateTransactionAttempts1760000000017 implements MigrationInterface {
  name = "CreateTransactionAttempts1760000000017";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."transaction_attempts_status_enum" AS ENUM('pending', 'completed', 'failed')`,
    );
    await queryRunner.query(`
      CREATE TABLE "transaction_attempts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "txHash" character varying(64) NOT NULL,
        "projectId" character varying(32) NOT NULL,
        "sourceAccount" character varying(128) NOT NULL,
        "networkPassphrase" character varying(128) NOT NULL,
        "submittedAt" bigint NOT NULL,
        "status" "public"."transaction_attempts_status_enum" NOT NULL DEFAULT 'pending',
        "failureCode" character varying(64),
        "failureLedger" bigint,
        "lastCheckedAt" bigint,
        CONSTRAINT "PK_transaction_attempts_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_transaction_attempts_tx_hash" UNIQUE ("txHash")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_transaction_attempts_source_status" ON "transaction_attempts" ("sourceAccount", "status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_transaction_attempts_source_status"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "transaction_attempts"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."transaction_attempts_status_enum"`,
    );
  }
}
