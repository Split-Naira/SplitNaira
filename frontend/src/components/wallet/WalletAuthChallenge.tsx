"use client";

/**
 * Issue #1264: WalletAuthChallenge — wallet authentication challenge UX.
 *
 * Acceptance criteria:
 * - Explains why a signature is requested (identity proof, not payment).
 * - Clearly distinguishes signing from payment approval.
 * - Handles rejection (user dismissed / cancelled in wallet).
 * - Handles expiry (challenge TTL elapsed) and offers safe refresh.
 * - Provides a safe challenge refresh that never reuses an expired nonce.
 *
 * Usage:
 *   <WalletAuthChallenge
 *     challenge={challengeNonce}
 *     expiresAt={expiresAt}
 *     onSign={handleSign}
 *     onRefresh={handleRefresh}
 *     onCancel={handleCancel}
 *   />
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { clsx } from "clsx";

// ── Types ─────────────────────────────────────────────────────────────────────

export type WalletAuthChallengeStatus =
  | "idle"
  | "awaiting_signature"
  | "rejected"
  | "expired"
  | "error"
  | "success";

export interface WalletAuthChallengeProps {
  /**
   * The challenge nonce returned by the server. Never persisted on the
   * client — passed to `onSign` for the wallet to sign and discarded.
   */
  challenge: string;

  /**
   * UTC timestamp (ms) when the challenge expires.
   * The component monitors this and shows a refresh UI when elapsed.
   */
  expiresAt: number;

  /**
   * Called with the signed XDR or signature string once the user approves
   * in their wallet. The parent is responsible for verifying it server-side.
   */
  onSign: (challenge: string) => Promise<void>;

  /**
   * Called when the user requests a new challenge (expired or manual refresh).
   * Must request a fresh nonce from the server — never reuse the expired one.
   */
  onRefresh: () => Promise<void>;

  /**
   * Called when the user dismisses the challenge dialog entirely.
   */
  onCancel: () => void;

  /** Additional class names for the container. */
  className?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function WalletAuthChallenge({
  challenge,
  expiresAt,
  onSign,
  onRefresh,
  onCancel,
  className,
}: WalletAuthChallengeProps) {
  const [status, setStatus] = useState<WalletAuthChallengeStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  /** Announced once a refreshed challenge has actually arrived. */
  const [politeNotice, setPoliteNotice] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number>(() =>
    Math.max(0, expiresAt - Date.now()),
  );

  // Track mount state to avoid state updates after unmount.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Recalculate timeRemaining immediately when expiresAt prop changes
  // (e.g. after a challenge refresh gives a new expiry).
  const prevExpiresAtRef = useRef(expiresAt);
  useEffect(() => {
    if (prevExpiresAtRef.current !== expiresAt) {
      prevExpiresAtRef.current = expiresAt;
      if (mountedRef.current) {
        setTimeRemaining(Math.max(0, expiresAt - Date.now()));
      }
    }
  }, [expiresAt]);

  // ── Expiry timer ─────────────────────────────────────────────────────────

  useEffect(() => {
    const interval = setInterval(() => {
      if (!mountedRef.current) return;

      const remaining = Math.max(0, expiresAt - Date.now());
      setTimeRemaining(remaining);

      if (remaining === 0 && status !== "expired" && status !== "success") {
        setStatus("expired");
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAt, status]);

  // Reset status when a new challenge arrives (after refresh).
  const prevChallengeRef = useRef(challenge);
  useEffect(() => {
    if (prevChallengeRef.current !== challenge) {
      prevChallengeRef.current = challenge;
      if (mountedRef.current) {
        setStatus("idle");
        setErrorMessage(null);
        setPoliteNotice("A new challenge is ready. Sign to continue.");
      }
    }
  }, [challenge]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleSign = useCallback(async () => {
    if (status === "expired") return;
    setStatus("awaiting_signature");
    setErrorMessage(null);
    setPoliteNotice(null);

    try {
      await onSign(challenge);
      if (mountedRef.current) setStatus("success");
    } catch (err) {
      if (!mountedRef.current) return;

      const message =
        err instanceof Error ? err.message : "Unknown error during signing.";

      // Classify: user explicitly rejected vs other error.
      const isRejection =
        message.toLowerCase().includes("user rejected") ||
        message.toLowerCase().includes("user declined") ||
        message.toLowerCase().includes("cancelled") ||
        message.toLowerCase().includes("denied");

      setStatus(isRejection ? "rejected" : "error");
      setErrorMessage(
        isRejection
          ? null // Rejection uses its own messaging, not a raw error string.
          : "Something went wrong while requesting your signature. Please try again.",
      );
    }
  }, [challenge, onSign, status]);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    setErrorMessage(null);

    try {
      await onRefresh();
      // Parent is responsible for updating `challenge` + `expiresAt` props.
      // The useEffect above resets status when `challenge` changes.
    } catch (err) {
      if (!mountedRef.current) return;
      const message =
        err instanceof Error ? err.message : "Failed to refresh challenge.";
      setStatus("error");
      setErrorMessage(message);
    } finally {
      if (mountedRef.current) setIsRefreshing(false);
    }
  }, [isRefreshing, onRefresh]);

  const handleRetry = useCallback(() => {
    setStatus("idle");
    setErrorMessage(null);
    setPoliteNotice(null);
  }, []);

  // ── Derived values ────────────────────────────────────────────────────────

  const isExpired = status === "expired" || timeRemaining === 0;
  const secondsRemaining = Math.ceil(timeRemaining / 1000);
  const isNearExpiry = secondsRemaining > 0 && secondsRemaining <= 30;

  // ── Screen-reader announcements (#1589) ──────────────────────────────────
  //
  // A persistent live region is used instead of relying on the visual state
  // blocks, which mount with their content and therefore are not reliably
  // announced. The countdown is intentionally excluded: announcing every tick
  // would drown out the state changes that matter.
  // Wording is deliberately distinct from the visual blocks so a screen-reader
  // announcement never duplicates the visible copy for assistive tech that
  // reads both the live region and the dialog content.
  const assertiveAnnouncement = isExpired
    ? "Challenge expired. Request a new challenge to continue."
    : status === "rejected"
      ? "Signature request cancelled. No data was sent or stored."
      : status === "error"
        ? "The signature request failed. Please try again."
        : "";

  const politeAnnouncement = isRefreshing
    ? "Requesting a new challenge."
    : status === "awaiting_signature"
      ? "Waiting for your wallet to sign the identity challenge."
      : status === "success"
        ? "Wallet signature accepted. You are verified."
        : (politeNotice ?? "");

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="wallet-auth-title"
      aria-describedby="wallet-auth-description"
      className={clsx(
        "rounded-xl border bg-white p-6 shadow-lg dark:bg-gray-900",
        "max-w-md w-full mx-auto",
        className,
      )}
    >
      {/* Live regions must exist before their text changes to be announced. */}
      <div
        data-testid="wallet-auth-live-polite"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {politeAnnouncement}
      </div>
      <div
        data-testid="wallet-auth-live-assertive"
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
      >
        {assertiveAnnouncement}
      </div>

      {/* Header */}
      <div className="flex items-start gap-3 mb-5">
        <span aria-hidden="true" className="flex-shrink-0 text-2xl" role="img">
          🔐
        </span>
        <div>
          <h2
            id="wallet-auth-title"
            className="text-lg font-semibold text-gray-900 dark:text-gray-100"
          >
            Sign to verify your identity
          </h2>
          <p
            id="wallet-auth-description"
            className="mt-1 text-sm text-gray-600 dark:text-gray-400"
          >
            SplitNaira needs to confirm that you control this wallet. You are
            being asked to <strong>sign a short message</strong>, not approve a
            payment or transfer any funds.
          </p>
        </div>
      </div>

      {/* Signing vs payment distinction callout */}
      <div
        role="note"
        className="mb-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200"
      >
        <strong>This is not a payment.</strong> No tokens will leave your
        wallet. Your signature only proves you own this address — it cannot
        authorise any transaction.
      </div>

      {/* Expiry indicator */}
      {!isExpired && (
        <div
          className={clsx(
            "mb-5 flex items-center gap-2 text-sm",
            isNearExpiry
              ? "text-amber-700 dark:text-amber-400"
              : "text-gray-500 dark:text-gray-400",
          )}
        >
          <span aria-hidden="true">{isNearExpiry ? "⚠️" : "⏱️"}</span>
          <span>
            {isNearExpiry
              ? `Challenge expires in ${secondsRemaining}s — please sign soon.`
              : `Challenge valid for ${secondsRemaining}s.`}
          </span>
        </div>
      )}

      {/* Expired state */}
      {isExpired && (
        <div className="mb-5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-700 dark:bg-amber-950">
          <p className="font-medium text-amber-800 dark:text-amber-200">
            This challenge has expired.
          </p>
          <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
            For your security, challenges are single-use and time-limited.
            Request a new one to continue.
          </p>
        </div>
      )}

      {/* Rejected state */}
      {status === "rejected" && (
        <div className="mb-5 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 dark:border-orange-800 dark:bg-orange-950">
          <p className="font-medium text-orange-800 dark:text-orange-200">
            Signature cancelled.
          </p>
          <p className="mt-1 text-sm text-orange-700 dark:text-orange-300">
            You dismissed the signing request in your wallet. No data was sent
            or stored. You can try again when you are ready.
          </p>
        </div>
      )}

      {/* Generic error state */}
      {status === "error" && errorMessage && (
        <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-950">
          <p className="font-medium text-red-800 dark:text-red-200">
            Signing failed.
          </p>
          <p className="mt-1 text-sm text-red-700 dark:text-red-300">
            {errorMessage}
          </p>
        </div>
      )}

      {/* Success state */}
      {status === "success" && (
        <div className="mb-5 rounded-lg border border-green-200 bg-green-50 px-4 py-3 dark:border-green-800 dark:bg-green-950">
          <p className="font-medium text-green-800 dark:text-green-200">
            ✓ Identity verified.
          </p>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-col gap-3 sm:flex-row-reverse">
        {/* Primary: Sign */}
        {!isExpired && status !== "success" && (
          <button
            type="button"
            onClick={() => void handleSign()}
            disabled={status === "awaiting_signature" || isExpired}
            aria-busy={status === "awaiting_signature"}
            className={clsx(
              "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5",
              "text-sm font-semibold text-white transition-colors",
              "bg-violet-600 hover:bg-violet-700 focus-visible:outline focus-visible:outline-2",
              "focus-visible:outline-offset-2 focus-visible:outline-violet-600",
              "disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            {status === "awaiting_signature" ? (
              <>
                <svg
                  className="h-4 w-4 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                Waiting for wallet…
              </>
            ) : status === "rejected" || status === "error" ? (
              "Try again"
            ) : (
              "Sign to continue"
            )}
          </button>
        )}

        {/* Refresh: shown when expired or manual refresh requested */}
        {isExpired && (
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={isRefreshing}
            aria-busy={isRefreshing}
            className={clsx(
              "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5",
              "text-sm font-semibold transition-colors",
              "bg-amber-500 text-white hover:bg-amber-600",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
              "focus-visible:outline-amber-500 disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            {isRefreshing ? "Requesting new challenge…" : "Get new challenge"}
          </button>
        )}

        {/* Retry after rejection/error (when not expired) */}
        {!isExpired && (status === "rejected" || status === "error") && (
          <button
            type="button"
            onClick={handleRetry}
            className={clsx(
              "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5",
              "text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100",
              "dark:text-gray-300 dark:hover:bg-gray-800",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
              "focus-visible:outline-gray-500",
            )}
          >
            Start over
          </button>
        )}

        {/* Cancel: always available (unless success) */}
        {status !== "success" && (
          <button
            type="button"
            onClick={onCancel}
            disabled={status === "awaiting_signature"}
            className={clsx(
              "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5",
              "text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100",
              "dark:text-gray-400 dark:hover:bg-gray-800",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
              "focus-visible:outline-gray-400 disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            Cancel
          </button>
        )}
      </div>

      {/* Security footer */}
      <p className="mt-5 text-center text-xs text-gray-400 dark:text-gray-600">
        This signature is only valid for this session and expires shortly.
        SplitNaira never stores your private key.
      </p>
    </section>
  );
}
