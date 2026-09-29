import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn
} from "typeorm";
import { DEFAULT_USER_ROLE } from "../lib/user-roles.js";
import type { UserRole } from "../lib/user-roles.js";

@Entity("users")
export class User {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ unique: true, type: "varchar", length: 128 })
  walletAddress!: string;

  @Column({ type: "varchar", length: 128, nullable: true })
  email?: string;

  @Column({ type: "varchar", length: 128, nullable: true })
  alias?: string;

  @Column({ type: "varchar", length: 32, default: DEFAULT_USER_ROLE })
  role!: UserRole;

  @Column({ type: "boolean", default: true })
  isActive!: boolean;

  /**
   * Soft-delete marker (#1333). Null means active. Set by `DELETE /users/me`.
   * Deliberately NOT applied to `TransactionRecord` or `AuditLog` — those
   * are financial/audit history and must survive a user deleting their
   * account, so this column exists only on user-owned, non-financial
   * records. See `lib/soft-delete.ts` for the retention policy.
   */
  @Column({ type: "timestamptz", nullable: true })
  deletedAt!: Date | null;

  @CreateDateColumn({ type: "timestamp" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}