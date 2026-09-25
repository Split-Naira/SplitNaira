"use client";

import * as Sentry from "@sentry/nextjs";

/**
 * Frontend telemetry for primary split lifecycle actions.
 *
 * Each action emits a `started` event, optionally `submitted` once the RPC
 * accepts the transaction, and exactly one terminal `succeeded` / `failed`
 * event. Events are recorded as Sentry breadcrumbs (category
 * `split.lifecycle`) so they are attached to any later error report, and are
 * fanned out to registered sinks (e.g. a product-analytics adapter).
 *
 * Privacy: wallet addresses and contract IDs are never accepted as event
 * properties, and failure messages are scrubbed before emission.
 */

export type SplitLifecycleAction =
  | "create"
  | "deposit"
  | "distribute"
  | "lock"
  | "update_metadata"
  | "update_collaborators";

export type SplitLifecycleStage = "started" | "submitted" | "succeeded" | "failed";

export interface SplitLifecycleEvent {
  name: `split.${SplitLifecycleAction}.${SplitLifecycleStage}`;
  action: SplitLifecycleAction;
  stage: SplitLifecycleStage;
  projectId?: string;
  /** Milliseconds since `started`; present on every stage after `started`. */
  durationMs?: number;
  txHash?: string;
  /** Coarse failure bucket for dashboards; present only on `failed`. */
  errorKind?: SplitLifecycleErrorKind;
  /** Scrubbed failure message; present only on `failed`. */
  errorMessage?: string;
  /** Low-cardinality, non-PII extras (e.g. collaborator count). */
  props?: Record<string, string | number | boolean>;
  timestamp: number;
}

export type SplitLifecycleErrorKind =
  | "user_rejected"
  | "timeout"
  | "network"
  | "contract"
  | "unknown";

export type TelemetrySink = (event: SplitLifecycleEvent) => void;

const sinks = new Set<TelemetrySink>();

/** Registers a sink; returns an unsubscribe function. */
export function registerTelemetrySink(sink: TelemetrySink): () => void {
  sinks.add(sink);
  return () => {
    sinks.delete(sink);
  };
}

const ADDRESS_PATTERN = /\b[GC][A-Z2-7]{55}\b/g;

export function scrubTelemetryText(text: string): string {
  return text.replace(ADDRESS_PATTERN, "[WALLET_REDACTED]").slice(0, 300);
}

export function classifyLifecycleError(error: unknown): SplitLifecycleErrorKind {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (name === "TimeoutError" || /timed? ?out|not confirmed in time/i.test(message)) {
    return "timeout";
  }
  if (/reject|declin|denied|cancel/i.test(message)) return "user_rejected";
  if (/offline|network|fetch|busy|try again/i.test(message)) return "network";
  if (/contract|ledger|HostError|Error\(Contract/i.test(message)) return "contract";
  return "unknown";
}

export function emitSplitLifecycleEvent(event: SplitLifecycleEvent): void {
  try {
    Sentry.addBreadcrumb({
      category: "split.lifecycle",
      message: event.name,
      level: event.stage === "failed" ? "warning" : "info",
      data: {
        action: event.action,
        stage: event.stage,
        projectId: event.projectId,
        durationMs: event.durationMs,
        txHash: event.txHash,
        errorKind: event.errorKind,
        ...event.props,
      },
    });
  } catch {
    /* telemetry must never break the user flow */
  }
  for (const sink of sinks) {
    try {
      sink(event);
    } catch {
      /* isolate faulty sinks */
    }
  }
}

export interface SplitLifecycleTracker {
  submitted(txHash: string): void;
  succeeded(): void;
  failed(error: unknown): void;
}

/**
 * Starts tracking one lifecycle action and emits `started` immediately.
 * Terminal stages are emitted at most once per tracker.
 */
export function trackSplitLifecycle(
  action: SplitLifecycleAction,
  context: { projectId?: string; props?: SplitLifecycleEvent["props"] } = {},
): SplitLifecycleTracker {
  const startedAt = Date.now();
  let txHash: string | undefined;
  let finished = false;

  const emit = (
    stage: SplitLifecycleStage,
    extra: Partial<SplitLifecycleEvent> = {},
  ) => {
    const now = Date.now();
    emitSplitLifecycleEvent({
      name: `split.${action}.${stage}`,
      action,
      stage,
      projectId: context.projectId,
      props: context.props,
      txHash,
      durationMs: stage === "started" ? undefined : now - startedAt,
      timestamp: now,
      ...extra,
    });
  };

  emit("started");

  return {
    submitted(hash) {
      if (finished) return;
      txHash = hash;
      emit("submitted");
    },
    succeeded() {
      if (finished) return;
      finished = true;
      emit("succeeded");
    },
    failed(error) {
      if (finished) return;
      finished = true;
      const message = error instanceof Error ? error.message : String(error ?? "");
      emit("failed", {
        errorKind: classifyLifecycleError(error),
        errorMessage: scrubTelemetryText(message),
      });
    },
  };
}
