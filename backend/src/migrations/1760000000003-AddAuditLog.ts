import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAuditLog1760000000003 implements MigrationInterface {
  name = "AddAuditLog1760000000003";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "audit_log" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "action" character varying(128) NOT NULL,
        "performed_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "ip_hash" character varying(16) NOT NULL,
        "request_id" character varying(64) NOT NULL,
        "payload" jsonb,
        CONSTRAINT "PK_audit_log" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_audit_log_action" ON "audit_log" ("action")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_audit_log_action"`);
    await queryRunner.query(`DROP TABLE "audit_log"`);
  }
}
