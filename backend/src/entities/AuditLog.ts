import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index
} from "typeorm";

@Entity("audit_log")
export class AuditLog {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 128 })
  @Index()
  action!: string;

  @CreateDateColumn({ name: "performed_at", type: "timestamptz" })
  performedAt!: Date;

  @Column({ name: "ip_hash", type: "varchar", length: 16 })
  ipHash!: string;

  @Column({ name: "request_id", type: "varchar", length: 64 })
  requestId!: string;

  @Column({ type: "jsonb", nullable: true })
  payload!: Record<string, unknown> | null;
}
