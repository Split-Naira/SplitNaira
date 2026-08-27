import React from "react";

import type {
  TransactionStatusTimelineProps,
  TransactionTimelineStepStatus,
} from "./TransactionStatusTimeline.types";

const stepStatusStyles: Record<
  TransactionTimelineStepStatus,
  {
    indicator: string;
    line: string;
  }
> = {
  pending: {
    indicator:
      "border-gray-300 bg-white text-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-500",
    line: "bg-gray-200 dark:bg-gray-700",
  },
  active: {
    indicator:
      "border-blue-500 bg-blue-500 text-white animate-pulse",
    line: "bg-blue-500",
  },
  success: {
    indicator:
      "border-green-500 bg-green-500 text-white",
    line: "bg-green-500",
  },
  failed: {
    indicator:
      "border-red-500 bg-red-500 text-white",
    line: "bg-red-500",
  },
};

const statusIcons: Record<TransactionTimelineStepStatus, string> = {
  pending: "",
  active: "…",
  success: "✓",
  failed: "!",
};

export function TransactionStatusTimeline({
  steps,
  status = "idle",
  error,
  onRetry,
  className = "",
}: TransactionStatusTimelineProps) {
  return (
    <section
      className={`w-full rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950 ${className}`}
      aria-label="Transaction status"
    >
      <div className="mb-5">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">
          Transaction Progress
        </h3>

        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Track the progress of your transaction.
        </p>
      </div>

      <ol className="space-y-0">
        {steps.map((step, index) => {
          const isLastStep = index === steps.length - 1;
          const styles = stepStatusStyles[step.status];

          return (
            <li
              key={step.id}
              className="relative flex gap-4 pb-6 last:pb-0"
            >
              {!isLastStep && (
                <span
                  aria-hidden="true"
                  className={`absolute left-[15px] top-8 h-[calc(100%-16px)] w-0.5 ${styles.line}`}
                />
              )}

              <div
                className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold ${styles.indicator}`}
                aria-label={`${step.label}: ${step.status}`}
              >
                {step.status === "active" ? (
                  <span className="animate-pulse">...</span>
                ) : (
                  statusIcons[step.status]
                )}
              </div>

              <div className="min-w-0 flex-1 pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-gray-900 dark:text-white">
                    {step.label}
                  </p>

                  {step.status === "active" && (
                    <span className="text-xs text-blue-600 dark:text-blue-400">
                      Processing
                    </span>
                  )}

                  {step.status === "failed" && (
                    <span className="text-xs text-red-600 dark:text-red-400">
                      Failed
                    </span>
                  )}
                </div>

                {step.description && (
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    {step.description}
                  </p>
                )}

                {step.explorerUrl && step.status === "success" && (
                  <a
                    href={step.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
                  >
                    View in explorer
                    <span aria-hidden="true">&nbsp;↗</span>
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {status === "loading" && (
        <div
          className="mt-6 rounded-md bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:bg-blue-950/30 dark:text-blue-300"
          role="status"
        >
          Your transaction is being processed. Please wait.
        </div>
      )}

      {status === "failed" && (
        <div
          className="mt-6 rounded-md border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30"
          role="alert"
        >
          <p className="text-sm font-medium text-red-700 dark:text-red-300">
            Transaction failed
          </p>

          {error && (
            <p className="mt-1 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
            >
              Retry transaction
            </button>
          )}
        </div>
      )}
    </section>
  );
}