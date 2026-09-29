import { MigrationInterface, QueryRunner } from "typeorm";

export class AddFrequentQueryIndexes1760000000007 implements MigrationInterface {
  name = "AddFrequentQueryIndexes1760000000007";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE INDEX "IDX_users_email" ON "users" ("email")`);
    await queryRunner.query(`CREATE INDEX "IDX_transactions_recipient_timestamp" ON "transactions" ("recipient", "timestamp")`);
    await queryRunner.query(`CREATE INDEX "IDX_ledger_blocks_project_id" ON "ledger_blocks" ("projectId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_ledger_blocks_project_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_transactions_recipient_timestamp"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_users_email"`);
  }
}
