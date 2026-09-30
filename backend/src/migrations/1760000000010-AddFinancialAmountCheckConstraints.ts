import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Issue #1337: reject invalid monetary values at the database level.
 *
 * transactions.amount is text (varchar), so the constraint first checks the
 * format, then the range. The CASE guarantees the numeric cast only runs on
 * text that already matched the pattern.
 *
 * Valid: canonical non-negative amount, no sign, no leading zeros, at most 7
 * decimal places (Stellar precision), at most the largest i128 (Soroban's
 * amount type).
 */
const CHECK_NAME = "CHK_transactions_amount_valid";
const AMOUNT_PATTERN = "^(0|[1-9][0-9]{0,38})([.][0-9]{1,7})?$";
const AMOUNT_MAX = "170141183460469231731687303715884105727";
const AMOUNT_CHECK = `CASE WHEN "amount" ~ '${AMOUNT_PATTERN}' THEN "amount"::numeric <= ${AMOUNT_MAX} ELSE false END`;

export class AddFinancialAmountCheckConstraints1760000000010 implements MigrationInterface {
  name = "AddFinancialAmountCheckConstraints1760000000010";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows = (await queryRunner.query(
      `SELECT count(*)::int AS "n" FROM "transactions" WHERE NOT (${AMOUNT_CHECK})`,
    )) as Array<{ n: number }>;
    const invalid = rows[0]?.n ?? 0;
    if (invalid > 0) {
      throw new Error(
        `Cannot add ${CHECK_NAME}: ${invalid} existing row(s) in "transactions" have an invalid amount. Fix or remove them, then run the migration again.`,
      );
    }

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = '${CHECK_NAME}'
            AND conrelid = '"transactions"'::regclass
        ) THEN
          ALTER TABLE "transactions"
            ADD CONSTRAINT "${CHECK_NAME}" CHECK (${AMOUNT_CHECK});
        END IF;
      END
      $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "${CHECK_NAME}"`,
    );
  }
}