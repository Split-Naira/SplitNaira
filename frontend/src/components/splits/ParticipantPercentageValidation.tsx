/**
 * Issue #1301 – Participant percentage validation UI.
 *
 * Shows live total percentage, highlights invalid totals, and blocks submit.
 * Server-side basisPoints validation remains authoritative (must sum to 10000).
 */

"use client";

import { useMemo } from "react";

export const BASIS_POINTS_TOTAL = 10_000;

export interface ParticipantShare {
  /** Display label (alias or truncated address) */
  label?: string;
  /** Share in basis points (10000 = 100%) */
  basisPoints: number;
}

export interface PercentageValidationResult {
  totalBasisPoints: number;
  totalPercent: number;
  isValid: boolean;
  deltaBasisPoints: number;
  message: string;
}

/**
 * Pure validation used by the UI and unit tests.
 * Server remains authoritative for final enforcement.
 */
export function validateParticipantPercentages(
  participants: ParticipantShare[]
): PercentageValidationResult {
  const totalBasisPoints = participants.reduce(
    (sum, p) => sum + (Number.isFinite(p.basisPoints) ? p.basisPoints : 0),
    0
  );
  const totalPercent = totalBasisPoints / 100;
  const deltaBasisPoints = totalBasisPoints - BASIS_POINTS_TOTAL;
  const isValid = totalBasisPoints === BASIS_POINTS_TOTAL;

  let message: string;
  if (isValid) {
    message = "Shares total 100%.";
  } else if (deltaBasisPoints < 0) {
    message = `Shares total ${totalPercent.toFixed(2)}% — add ${(Math.abs(deltaBasisPoints) / 100).toFixed(2)}% more.`;
  } else {
    message = `Shares total ${totalPercent.toFixed(2)}% — reduce by ${(deltaBasisPoints / 100).toFixed(2)}%.`;
  }

  return { totalBasisPoints, totalPercent, isValid, deltaBasisPoints, message };
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
  const result = useMemo(() => {
    const r = validateParticipantPercentages(participants);
    onValidityChange?.(r.isValid);
    return r;
  }, [participants, onValidityChange]);

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
