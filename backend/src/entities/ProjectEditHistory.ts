import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index
} from "typeorm";

@Entity("project_edit_history")
export class ProjectEditHistory {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "project_id", type: "varchar", length: 64 })
  @Index()
  projectId!: string;

  @Column({ type: "varchar", length: 128 })
  actor!: string;

  @Column({ type: "varchar", length: 128 })
  action!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @Column({ type: "jsonb", nullable: true })
  changes!: Record<string, unknown> | null;
}
