import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as Sentry from "@sentry/nextjs";

import {
  classifyLifecycleError,
  registerTelemetrySink,
  scrubTelemetryText,
  trackSplitLifecycle,
  type SplitLifecycleEvent,
} from "../lib/telemetry";

vi.mock("@sentry/nextjs", () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
}));

const WALLET = `G${"A".repeat(55)}`;

describe("split lifecycle telemetry", () => {
  let events: SplitLifecycleEvent[];
  let unsubscribe: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    events = [];
    unsubscribe = registerTelemetrySink((event) => events.push(event));
  });

  afterEach(() => unsubscribe());

  it("emits started, submitted and succeeded for a successful action", () => {
    const tracker = trackSplitLifecycle("distribute", {
      projectId: "album-1",
      props: { round: 2 },
    });
    tracker.submitted("abc123");
    tracker.succeeded();

    expect(events.map((e) => e.name)).toEqual([
      "split.distribute.started",
      "split.distribute.submitted",
      "split.distribute.succeeded",
    ]);
    expect(events[0].durationMs).toBeUndefined();
    expect(events[2]).toMatchObject({
      projectId: "album-1",
      txHash: "abc123",
      props: { round: 2 },
    });
    expect(events[2].durationMs).toBeGreaterThanOrEqual(0);
    expect(Sentry.addBreadcrumb).toHaveBeenCalledTimes(3);
    expect(Sentry.addBreadcrumb).toHaveBeenLastCalledWith(
      expect.objectContaining({
        category: "split.lifecycle",
        message: "split.distribute.succeeded",
        level: "info",
      }),
    );
  });

  it("emits a classified, scrubbed failed event", () => {
    const tracker = trackSplitLifecycle("deposit", { projectId: "p" });
    tracker.failed(new Error(`User rejected signing for ${WALLET}`));

    const failed = events.at(-1)!;
    expect(failed.name).toBe("split.deposit.failed");
    expect(failed.errorKind).toBe("user_rejected");
    expect(failed.errorMessage).not.toContain(WALLET);
    expect(failed.errorMessage).toContain("[WALLET_REDACTED]");
    expect(Sentry.addBreadcrumb).toHaveBeenLastCalledWith(
      expect.objectContaining({ level: "warning" }),
    );
  });

  it("emits at most one terminal event per tracker", () => {
    const tracker = trackSplitLifecycle("lock");
    tracker.succeeded();
    tracker.failed(new Error("late"));
    tracker.submitted("late-hash");

    expect(events.map((e) => e.stage)).toEqual(["started", "succeeded"]);
  });

  it("isolates faulty sinks and Sentry failures from the user flow", () => {
    vi.mocked(Sentry.addBreadcrumb).mockImplementationOnce(() => {
      throw new Error("sentry down");
    });
    const off = registerTelemetrySink(() => {
      throw new Error("sink down");
    });

    expect(() => trackSplitLifecycle("create")).not.toThrow();
    expect(events).toHaveLength(1);
    off();
  });

  it("classifies common error shapes", () => {
    const timeout = new Error("x");
    timeout.name = "TimeoutError";
    expect(classifyLifecycleError(timeout)).toBe("timeout");
    expect(classifyLifecycleError(new Error("Failed to fetch"))).toBe("network");
    expect(classifyLifecycleError(new Error("Transaction failed on ledger"))).toBe("contract");
    expect(classifyLifecycleError("???")).toBe("unknown");
  });

  it("truncates scrubbed text", () => {
    expect(scrubTelemetryText("a".repeat(1000))).toHaveLength(300);
  });
});
