import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/**
 * Record of a project being archived (#1315).
 *
 * Off-chain marker, same shape as `SplitCancellation` (#1304): the Soroban
 * contract has no `archive` function, so this hides the project from
 * active-project surfaces and blocks new mutating actions through the API —
 * it cannot stop someone calling the contract directly. A real guarantee
 * needs a contract change; see `SplitCancellation` for the same caveat.
 *
 * Rows are never deleted, even after restoration — "preserve financial
 * history" is an acceptance criterion, and a project that was archived and
 * later restored needs to show that it happened, by whom, and when. This
 * table only ever records archive/restore *events*; it has no foreign key
 * to `transactions` or `audit_log` and never causes a write to either, so a
 * project's financial history is untouched regardless of archival state.
 *
 * A project can be archived and restored more than once, so unlike
 * `SplitCancellation` this is NOT unique-per-project — `getArchivalState`
 * in the service layer reads the latest row to determine current status.
 */
@Entity("project_archivals")
@Index("IDX_project_archivals_project", ["projectId"])
export class ProjectArchival {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** On-chain project id. */
  @Column({ type: "varchar", length: 128 })
  projectId!: string;

  /** Wallet that authorised the archival — the project owner. */
  @Column({ type: "varchar", length: 128 })
  archivedBy!: string;

  @Column({ type: "varchar", length: 500, nullable: true })
  reason!: string | null;

  @Column({ type: "timestamptz", default: () => "now()" })
  archivedAt!: Date;

  /** Set once this archival is reversed by an authorized restoration. Null while still archived. */
  @Column({ type: "varchar", length: 128, nullable: true })
  restoredBy!: string | null;

  @Column({ type: "timestamptz", nullable: true })
  restoredAt!: Date | null;
}
