import {
  Check,
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

export const TRANSACTION_STATUSES = ["pending", "completed", "failed"] as const;

export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const TRANSACTION_AMOUNT_CHECK_NAME = "CHK_transactions_amount_valid";
export const TRANSACTION_AMOUNT_CHECK = `CASE WHEN "amount" ~ '^(0|[1-9][0-9]{0,38})([.][0-9]{1,7})?$' THEN "amount"::numeric <= 170141183460469231731687303715884105727 ELSE false END`;

@Entity("transactions")
@Check(TRANSACTION_AMOUNT_CHECK_NAME, TRANSACTION_AMOUNT_CHECK)
@Index("IDX_transactions_round_id", ["roundId"])
@Index("IDX_transactions_recipient", ["recipient"])
@Index("IDX_transactions_timestamp", ["timestamp"])
@Index("IDX_transactions_recipient_timestamp", ["recipient", "timestamp"])
export class TransactionRecord {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 64 })
  roundId!: string;

  @Column({ type: "varchar", length: 128 })
  recipient!: string;

  @Column({ type: "varchar", length: 64 })
  amount!: string;

  @Column({ type: "varchar", length: 128 })
  token!: string;

  @Column({
    type: "bigint",
    transformer: {
      to: (value: number) => value,
      from: (value: string) => Number(value),
    },
  })
  timestamp!: number;

  @Index("IDX_transactions_tx_hash", { unique: true })
  @Column({ type: "varchar", length: 128, unique: true })
  txHash!: string;

  @Column({
    type: "enum",
    enum: TRANSACTION_STATUSES,
    default: "pending",
  })
  status!: TransactionStatus;
}
