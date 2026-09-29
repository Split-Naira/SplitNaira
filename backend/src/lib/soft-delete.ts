/**
 * Soft-delete policy for user-owned records (#1333).
 *
 * Scope: soft delete applies only to records that belong to a user and
 * carry no financial/audit meaning on their own — currently just `User`.
 * It deliberately does NOT apply to `TransactionRecord` (payout history)
 * or `AuditLog`: those are financial/audit history the platform must be
 * able to produce regardless of what the account that triggered them later
 * does, so a user deleting their account never deletes, hides, or mutates
 * them. Neither entity carries a `deletedAt` column, and no query in this
 * codebase should filter them by one.
 *
 * Retention: a soft-deleted record is kept for `SOFT_DELETE_RETENTION_DAYS`
 * after `deletedAt` before it becomes eligible for a hard purge. No
 * automatic purge job exists yet — `isPastRetention` / `purgeEligibleAt`
 * are what a future purge job (or an admin script) should use as the
 * eligibility check, so the policy is defined once rather than
 * re-derived wherever it's needed.
 */

export const SOFT_DELETE_RETENTION_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The instant a soft-deleted record becomes eligible for a hard purge. */
export function purgeEligibleAt(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + SOFT_DELETE_RETENTION_DAYS * MS_PER_DAY);
}

/** Whether a soft-deleted record is past its retention window right now. */
export function isPastRetention(deletedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() >= purgeEligibleAt(deletedAt).getTime();
}
