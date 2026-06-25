/**
 * TransactionReceiptView
 *
 * Boundary: pure presentational component.
 * Renders on-chain action receipts for create / deposit / distribute / lock,
 * including intermediate confirmation, success, and terminal failure states.
 */
"use client";

import { getExplorerUrl, getExplorerLabel } from "@/lib/stellar";

export type SorobanReceiptLifecycle = "confirming" | "success" | "failed" | "timeout";

export interface TransactionReceipt {
  hash: string;
  lifecycle: SorobanReceiptLifecycle;
  action: "create" | "deposit" | "distribute" | "lock";
  projectId: string;
  title?: string;
  amount?: string;
  round?: number;
  failureReason?: string;
}

export function TransactionReceiptView({
  receipt,
  network
}: {
  receipt: TransactionReceipt;
  network: string | null;
}) {
  const explorerUrl = getExplorerUrl(receipt.hash, network);
  const explorerLabel = getExplorerLabel(network);

  const actionCopy = {
    create: {
      successTitle: "Project Created Successfully",
      confirmingTitle: "Creating Project",
      failedTitle: "Project Creation Failed",
      successSummary: (r: TransactionReceipt) =>
        `Project "${r.title ?? r.projectId}" initialized.`,
      confirmingSummary: "Transaction accepted by the network — waiting for ledger inclusion.",
      failedSummary: "The transaction did not complete successfully."
    },
    deposit: {
      successTitle: "Deposit Successful",
      confirmingTitle: "Depositing Funds",
      failedTitle: "Deposit Failed",
      successSummary: (r: TransactionReceipt) =>
        `Deposited ${r.amount} tokens to ${r.projectId}.`,
      confirmingSummary: "Waiting for the deposit to finalize on ledger.",
      failedSummary: "The deposit transaction failed."
    },
    distribute: {
      successTitle: "Distribution Successful",
      confirmingTitle: "Running Distribution",
      failedTitle: "Distribution Failed",
      successSummary: (r: TransactionReceipt) =>
        `Round #${r.round} completed for ${r.projectId}.`,
      confirmingSummary: "Waiting for payout operations to finalize on ledger.",
      failedSummary: "The distribution transaction failed."
    },
    lock: {
      successTitle: "Project Locked Permanently",
      confirmingTitle: "Locking Project",
      failedTitle: "Lock Failed",
      successSummary: (r: TransactionReceipt) =>
        `Configuration for ${r.projectId} is now immutable.`,
      confirmingSummary: "Waiting for the lock to finalize on ledger.",
      failedSummary: "The lock transaction failed.",
      timeoutSummary: "The testnet is experiencing high latency. The lock transaction may still complete on-chain. Please verify on the explorer or try again."
    }
  }[receipt.action];

  const timeoutSummaryDefault = "The testnet is experiencing high latency. The transaction may still complete on-chain. Please verify on the explorer or try again.";

  const isConfirming = receipt.lifecycle === "confirming";
  const isFailed = receipt.lifecycle === "failed";
  const isSuccess = receipt.lifecycle === "success";
  const isTimeout = receipt.lifecycle === "timeout";

  const title = isFailed
    ? actionCopy.failedTitle
    : isTimeout
      ? "Transaction Timed Out"
      : isConfirming
        ? actionCopy.confirmingTitle
        : actionCopy.successTitle;

  const summary = isFailed
    ? actionCopy.failedSummary
    : isTimeout
      ? ('timeoutSummary' in actionCopy ? (actionCopy as Record<string, string>).timeoutSummary : undefined) || timeoutSummaryDefault
      : isConfirming
        ? actionCopy.confirmingSummary
        : actionCopy.successSummary(receipt);

  const borderClass = isFailed
    ? "border-red-400/30 bg-red-500/5"
    : isTimeout
      ? "border-orange-400/30 bg-orange-500/5"
      : isConfirming
        ? "border-amber-400/25 bg-amber-500/5"
        : "border-greenBright/20 bg-greenBright/5";

  const accentClass = isFailed
    ? "text-red-300"
    : isTimeout
      ? "text-orange-300"
      : isConfirming
        ? "text-amber-200"
        : "text-greenBright";

  const iconBgClass = isFailed
    ? "bg-red-500/15"
    : isTimeout
      ? "bg-orange-500/15"
      : isConfirming
        ? "bg-amber-500/15"
        : "bg-greenBright/10";

  const icons = {
    create: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    ),
    deposit: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
    ),
    distribute: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
      />
    ),
    lock: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
      />
    )
  };

  return (
    <div
      className={`mt-8 rounded-2xl border p-6 animate-in fade-in slide-in-from-bottom-4 ${borderClass}`}
    >
      <div className="flex items-start gap-4">
        <div
          className={`mt-1 flex h-10 w-10 items-center justify-center rounded-full ${iconBgClass}`}
        >
          {isConfirming ? (
            <svg
              className={`h-5 w-5 animate-spin ${accentClass}`}
              viewBox="0 0 24 24"
              fill="none"
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
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          ) : (
            <svg
              className={`h-6 w-6 ${accentClass}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              {icons[receipt.action]}
            </svg>
          )}
        </div>
        <div className="space-y-1">
          <h3
            className={`text-sm font-bold uppercase tracking-widest ${accentClass}`}
          >
            {title}
          </h3>
          <p className="text-[11px] text-muted-foreground font-medium italic opacity-90">
            {summary}
          </p>
          {isFailed && receipt.failureReason && (
            <p className="pt-1 text-[11px] font-medium leading-relaxed text-red-200/90">
              {receipt.failureReason}
            </p>
          )}
          {isTimeout && (
            <div className="pt-1">
              <button onClick={() => window.location.reload()} className="text-[11px] font-medium text-orange-200 hover:text-white underline">
                Refresh to Retry CTA
              </button>
            </div>
          )}
          <div className="pt-2 space-y-1">
            <p className="font-mono text-[9px] text-muted break-all opacity-60">
              Tx: {receipt.hash}
            </p>
            {(isSuccess || isConfirming || isTimeout) && (
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[10px] font-bold text-greenBright underline underline-offset-4 hover:text-white transition-colors"
              >
                Verify on {explorerLabel}
                <svg
                  className="h-3 w-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                  />
                </svg>
              </a>
            )}
            {isFailed && (
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[10px] font-bold text-red-300/90 underline underline-offset-4 hover:text-white transition-colors"
              >
                Inspect on {explorerLabel}
                <svg
                  className="h-3 w-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                  />
                </svg>
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
