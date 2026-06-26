import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserUpdatedAt1760000000004 implements MigrationInterface {
  name = "AddUserUpdatedAt1760000000004";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "updated_at" TIMESTAMPTZ DEFAULT NOW()`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "updated_at"`);
  }
}
