/**
 * Issue #1301 – Participant percentage validation UI.
 *
 * Shows live total percentage, highlights invalid totals, and blocks submit.
 * Server-side basisPoints validation remains authoritative (must sum to 10000).
 *
 * The total alone is not enough to call a split valid. Shares are basis-point
 * integers, so `[-500] + [10500]` sums to exactly 10000 while being impossible
 * to submit: one participant is owed a negative amount and the other is above
 * 100%. Both are reported rather than being silently added to the total.
 */

"use client";

import { useEffect, useMemo } from "react";

export const BASIS_POINTS_TOTAL = 10_000;

export interface ParticipantShare {
  /** Display label (alias or truncated address) */
  label?: string;
  /** Share in basis points (10000 = 100%) */
  basisPoints: number;
}

/** Why a single participant's share cannot be submitted. */
export type ParticipantShareProblem =
  | "not_a_number"
  | "not_whole_basis_points"
  | "negative"
  | "above_total";

export interface InvalidParticipantShare {
  index: number;
  label: string;
  problem: ParticipantShareProblem;
  /** Ready-to-display explanation naming the participant. */
  detail: string;
}

export interface PercentageValidationResult {
  totalBasisPoints: number;
  totalPercent: number;
  isValid: boolean;
  deltaBasisPoints: number;
  message: string;
  /** Shares that cannot be submitted, in participant order. */
  invalidShares: InvalidParticipantShare[];
}

const PROBLEM_SUFFIX: Record<ParticipantShareProblem, string> = {
  not_a_number: "has no numeric share",
  not_whole_basis_points: "must be a whole number of basis points",
  negative: "cannot have a negative share",
  above_total: `cannot exceed ${BASIS_POINTS_TOTAL} basis points`,
};

function labelFor(share: ParticipantShare | undefined, index: number): string {
  const label = share?.label?.trim();
  return label ? label : `Participant ${index + 1}`;
}

function problemWith(basisPoints: unknown): ParticipantShareProblem | null {
  if (typeof basisPoints !== "number" || !Number.isFinite(basisPoints)) {
    return "not_a_number";
  }
  if (!Number.isInteger(basisPoints)) return "not_whole_basis_points";
  if (basisPoints < 0) return "negative";
  if (basisPoints > BASIS_POINTS_TOTAL) return "above_total";
  return null;
}

/**
 * Pure validation used by the UI and unit tests.
 * Server remains authoritative for final enforcement.
 */
export function validateParticipantPercentages(
  participants: ParticipantShare[]
): PercentageValidationResult {
  const list = Array.isArray(participants) ? participants : [];
  const invalidShares: InvalidParticipantShare[] = [];
  let totalBasisPoints = 0;

  list.forEach((share, index) => {
    const problem = problemWith(share?.basisPoints);

    if (problem) {
      const label = labelFor(share, index);
      invalidShares.push({
        index,
        label,
        problem,
        detail: `${label} ${PROBLEM_SUFFIX[problem]}.`,
      });
      // An impossible share contributes nothing to the total; adding it would
      // let two broken shares mask each other.
      return;
    }

    totalBasisPoints += share.basisPoints;
  });

  const totalPercent = totalBasisPoints / 100;
  const deltaBasisPoints = totalBasisPoints - BASIS_POINTS_TOTAL;
  const isValid = invalidShares.length === 0 && totalBasisPoints === BASIS_POINTS_TOTAL;

  let message: string;
  if (invalidShares.length > 0) {
    const [first] = invalidShares;
    const remaining = invalidShares.length - 1;
    message =
      remaining > 0
        ? `${first.detail} And ${remaining} more ${remaining === 1 ? "share" : "shares"} need fixing.`
        : first.detail;
  } else if (isValid) {
    message = "Shares total 100%.";
  } else if (deltaBasisPoints < 0) {
    message = `Shares total ${totalPercent.toFixed(2)}% — add ${(Math.abs(deltaBasisPoints) / 100).toFixed(2)}% more.`;
  } else {
    message = `Shares total ${totalPercent.toFixed(2)}% — reduce by ${(deltaBasisPoints / 100).toFixed(2)}%.`;
  }

  return { totalBasisPoints, totalPercent, isValid, deltaBasisPoints, message, invalidShares };
}

export interface ParticipantPercentageValidationProps {
  participants: ParticipantShare[];
  /** When true, parent should disable submit */
  onValidityChange?: (isValid: boolean) => void;
  className?: string;
}

export function ParticipantPercentageValidation({
  participants,
  onValidityChange,
  className,
}: ParticipantPercentageValidationProps) {
  const result = useMemo(() => validateParticipantPercentages(participants), [participants]);
  const { isValid } = result;

  // Reporting validity is a side effect of rendering, not part of it. Calling
  // the parent's setter from inside `useMemo` notified it during the render
  // phase, which React warns about and which could loop when the parent's
  // state fed back into this component.
  useEffect(() => {
    onValidityChange?.(isValid);
  }, [isValid, onValidityChange]);

  return (
    <div
      className={
        className ??
        `rounded-lg border px-3 py-2 text-sm ${
          result.isValid
            ? "border-emerald-200 bg-emerald-50 text-emerald-900"
            : "border-red-300 bg-red-50 text-red-900"
        }`
      }
      role="status"
      aria-live="polite"
      data-testid="participant-percentage-validation"
      data-valid={result.isValid ? "true" : "false"}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">Total share</span>
        <span
          className={`font-mono text-base font-semibold ${
            result.isValid ? "text-emerald-800" : "text-red-700"
          }`}
          data-testid="total-percentage"
        >
          {result.totalPercent.toFixed(2)}%
        </span>
      </div>
      <p className="mt-1 text-xs" data-testid="percentage-message">
        {result.message}
      </p>
      {result.invalidShares.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-red-700" data-testid="invalid-shares">
          {result.invalidShares.map((share) => (
            <li key={`${share.index}-${share.problem}`}>{share.detail}</li>
          ))}
        </ul>
      )}
      {!result.isValid && (
        <p className="mt-1 text-xs font-medium text-red-700">
          Fix participant percentages before submitting. Server validation is
          authoritative.
        </p>
      )}
    </div>
  );
}

/**
 * Helper for forms: true when submission should be blocked client-side.
 */
export function shouldBlockSubmit(participants: ParticipantShare[]): boolean {
  return !validateParticipantPercentages(participants).isValid;
}

export default ParticipantPercentageValidation;
