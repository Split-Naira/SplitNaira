/**
 * Off-chain ownership snapshot reconciliation with chain state (#1633).
 *
 * Compares a database-held owner snapshot to the authoritative on-chain owner.
 * Mismatches are reported for operators; this module never writes the database
 * owner over chain state (chain remains authoritative).
 */

export type OwnershipSource = "database" | "chain";

export interface OwnershipSnapshot {
  projectId: string;
  /** Owner recorded off-chain (DB / cache). */
  dbOwner: string | null;
  /** Owner read from chain (authoritative). */
  chainOwner: string | null;
}

export interface OwnershipMismatch {
  projectId: string;
  dbOwner: string | null;
  chainOwner: string | null;
  /** Always `chain` — documents which side wins for access decisions. */
  authoritative: OwnershipSource;
  message: string;
}

export interface OwnershipReconcileReport {
  checked: number;
  matches: number;
  mismatches: OwnershipMismatch[];
  /** Projects missing on either side (null owner). */
  incomplete: number;
}

function norm(addr: string | null | undefined): string | null {
  if (addr == null || addr.trim() === "") return null;
  return addr.trim().toUpperCase();
}

/**
 * Compare one project's DB snapshot to chain. Does not mutate any store.
 */
export function compareOwnershipSnapshot(snapshot: OwnershipSnapshot): OwnershipMismatch | null {
  const dbOwner = norm(snapshot.dbOwner);
  const chainOwner = norm(snapshot.chainOwner);

  if (dbOwner === chainOwner) {
    return null;
  }

  return {
    projectId: snapshot.projectId,
    dbOwner,
    chainOwner,
    authoritative: "chain",
    message:
      chainOwner == null
        ? "Chain owner missing; database snapshot must not invent ownership"
        : dbOwner == null
          ? "Database snapshot missing owner present on chain"
          : "Database ownership snapshot differs from chain; chain is authoritative",
  };
}

/**
 * Reconcile a batch of snapshots. Pure report — callers must not use mismatches
 * to overwrite chain, only to alert or refresh the off-chain cache from chain.
 */
export function reconcileOwnershipSnapshots(
  snapshots: readonly OwnershipSnapshot[],
): OwnershipReconcileReport {
  const mismatches: OwnershipMismatch[] = [];
  let matches = 0;
  let incomplete = 0;

  for (const snap of snapshots) {
    const mismatch = compareOwnershipSnapshot(snap);
    if (mismatch === null) {
      matches += 1;
      if (norm(snap.dbOwner) == null) incomplete += 1;
    } else {
      mismatches.push(mismatch);
      if (mismatch.dbOwner == null || mismatch.chainOwner == null) incomplete += 1;
    }
  }

  return {
    checked: snapshots.length,
    matches,
    mismatches,
    incomplete,
  };
}

/**
 * Resolve the owner that authorization logic should use: always prefer chain
 * when present; never fall back to a conflicting DB value.
 */
export function resolveAuthoritativeOwner(snapshot: OwnershipSnapshot): string | null {
  const chainOwner = norm(snapshot.chainOwner);
  if (chainOwner != null) return chainOwner;
  // Chain unknown: do not promote DB as authoritative for financial actions.
  return null;
}
