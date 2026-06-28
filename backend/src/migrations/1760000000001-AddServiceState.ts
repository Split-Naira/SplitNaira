import { MigrationInterface, QueryRunner } from "typeorm";

export class AddServiceState1760000000001 implements MigrationInterface {
  name = "AddServiceState1760000000001";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "service_state" ("key" character varying(128) NOT NULL, "value" text NOT NULL, CONSTRAINT "PK_service_state_key" PRIMARY KEY ("key"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "service_state"`);
  }
}
