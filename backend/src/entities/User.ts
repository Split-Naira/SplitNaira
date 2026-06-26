import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn
} from "typeorm";

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

  @Column({ type: "varchar", length: 32, default: "user" })
  role!: string;

  @Column({ type: "boolean", default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: "timestamp" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}