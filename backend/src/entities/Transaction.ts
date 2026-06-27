import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

export const TRANSACTION_STATUSES = ["pending", "completed", "failed"] as const;

export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

@Entity("transactions")
@Index("IDX_transactions_round_id", ["roundId"])
@Index("IDX_transactions_recipient", ["recipient"])
@Index("IDX_transactions_timestamp", ["timestamp"])
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

  @Index({ unique: true })
  @Column({ type: "varchar", length: 128, unique: true })
  txHash!: string;

  @Column({
    type: "enum",
    enum: TRANSACTION_STATUSES,
    default: "pending",
  })
  status!: TransactionStatus;
}
