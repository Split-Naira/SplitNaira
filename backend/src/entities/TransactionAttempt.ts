import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from "typeorm";

export const TRANSACTION_ATTEMPT_STATUSES = ["pending", "completed", "failed"] as const;
export type TransactionAttemptStatus = (typeof TRANSACTION_ATTEMPT_STATUSES)[number];

@Entity("transaction_attempts")
@Unique("UQ_transaction_attempts_tx_hash", ["txHash"])
@Index("IDX_transaction_attempts_source_status", ["sourceAccount", "status"])
export class TransactionAttempt {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 64 })
  txHash!: string;

  @Column({ type: "varchar", length: 32 })
  projectId!: string;

  @Column({ type: "varchar", length: 128 })
  sourceAccount!: string;

  @Column({ type: "varchar", length: 128 })
  networkPassphrase!: string;

  @Column({
    type: "bigint",
    transformer: {
      to: (value: number) => value,
      from: (value: string) => Number(value),
    },
  })
  submittedAt!: number;

  @Column({
    type: "enum",
    enum: TRANSACTION_ATTEMPT_STATUSES,
    default: "pending",
  })
  status!: TransactionAttemptStatus;

  @Column({ type: "varchar", length: 64, nullable: true })
  failureCode!: string | null;

  @Column({
    type: "bigint",
    nullable: true,
    transformer: {
      to: (value: number | null) => value,
      from: (value: string | null) => (value === null ? null : Number(value)),
    },
  })
  failureLedger!: number | null;

  @Column({
    type: "bigint",
    nullable: true,
    transformer: {
      to: (value: number | null) => value,
      from: (value: string | null) => (value === null ? null : Number(value)),
    },
  })
  lastCheckedAt!: number | null;
}
