import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

export const LEDGER_BLOCK_TYPES = ["settlement", "milestone"] as const;
export type LedgerBlockType = (typeof LEDGER_BLOCK_TYPES)[number];

@Entity("ledger_blocks")
@Index("IDX_ledger_blocks_ledger_seq", ["ledgerSeq"])
@Index("IDX_ledger_blocks_tx_hash", ["txHash"])
@Index("IDX_ledger_blocks_project_id", ["projectId"])
export class LedgerBlock {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "bigint", transformer: { to: (value: number) => value, from: (value: string) => Number(value) } })
  ledgerSeq!: number;

  @Column({ type: "varchar", length: 128 })
  txHash!: string;

  @Column({ type: "enum", enum: LEDGER_BLOCK_TYPES })
  type!: LedgerBlockType;

  @Column({ type: "varchar", length: 64, nullable: true })
  projectId?: string;

  @Column({ type: "varchar", length: 128, nullable: true })
  recipient?: string;

  @Column({ type: "varchar", length: 64, nullable: true })
  amount?: string;

  @Column({ type: "timestamptz" })
  ledgerClosedAt!: Date;
}
