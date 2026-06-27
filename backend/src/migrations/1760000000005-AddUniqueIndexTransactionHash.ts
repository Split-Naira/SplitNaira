import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUniqueIndexTransactionHash1760000000005 implements MigrationInterface {
  name = "AddUniqueIndexTransactionHash1760000000005";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_transactions_tx_hash" ON "transactions" ("txHash")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_transactions_tx_hash"`);
  }
}
