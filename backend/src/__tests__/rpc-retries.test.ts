import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  executeWithRetry,
  boundRetryBudget,
  RPC_RETRY_BUDGET_MAX_RETRIES,
  RpcTimeoutError,
  RpcError,
  RequestValidationError,
} from "../services/stellar.js";
import { logger } from "../services/logger.js";
import {
  getRpcRetryAttemptsTotal,
  getRpcRetryBudgetSnapshots,
  getRpcRetryMaxAttemptsReachedTotal,
  getRpcRetrySnapshots,
  resetRequestMetrics,
} from "../services/metrics.js";

describe("RPC Retry and Timeout Policy", () => {
  describe("executeWithRetry Utility", () => {
    it("should return result immediately on success", async () => {
      const operation = vi.fn().mockResolvedValue("success");
      const result = await executeWithRetry(operation);
      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it("should retry transient failures and eventually succeed", async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error("Transient error"))
        .mockRejectedValueOnce(new Error("Transient error"))
        .mockResolvedValue("success");

      const result = await executeWithRetry(operation, { initialDelayMs: 1 });
      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it("should throw RpcTimeoutError when operation exceeds timeout", async () => {
      // Use a long-running promise to simulate a timeout
      const operation = vi.fn(() => new Promise((resolve) => {
        setTimeout(() => resolve("late"), 200);
      }));

      await expect(executeWithRetry(operation, { timeoutMs: 50 })).rejects.toThrow(RpcTimeoutError);
    }, 10000);

    it("should exhaust retries and throw the last error", async () => {
      const operation = vi.fn().mockRejectedValue(new Error("Persistent error"));

      await expect(executeWithRetry(operation, {
        maxRetries: 2,
        initialDelayMs: 1
      })).rejects.toThrow("Persistent error");

      expect(operation).toHaveBeenCalledTimes(3);
    });

    it("should NOT retry RequestValidationError", async () => {
      const operation = vi.fn().mockRejectedValue(new RequestValidationError("Invalid input"));

      await expect(executeWithRetry(operation, {
        maxRetries: 3,
        initialDelayMs: 1
      })).rejects.toThrow(RequestValidationError);

      expect(operation).toHaveBeenCalledTimes(1);
    });
  });

  describe("RPC Error Classes", () => {
    it("RpcError should have default status code 502", () => {
      const error = new RpcError("Failed");
      expect(error.statusCode).toBe(502);
      expect(error.name).toBe("RpcError");
    });

    it("RpcTimeoutError should have status code 504", () => {
      const error = new RpcTimeoutError();
      expect(error.statusCode).toBe(504);
      expect(error.name).toBe("RpcTimeoutError");
    });
  });

  // ===== Issue #836 observability tests =====
  describe("Issue #836: retry observability", () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      resetRequestMetrics();
      warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger);
      errorSpy = vi.spyOn(logger, "error").mockImplementation(() => logger);
    });

    afterEach(() => {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it("emits a structured retry log without the original error object for transient failures", async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error("Transient error with secret_key=SABCDEF"))
        .mockResolvedValue("ok");

      await executeWithRetry(operation, {
        initialDelayMs: 1,
        operation: "simulateTransaction",
        endpoint: "rpc",
      });

      expect(warnSpy).toHaveBeenCalled();
      const callArgs = warnSpy.mock.calls.find(([, meta]) =>
        meta && typeof meta === "object" && (meta as Record<string, unknown>).operation === "simulateTransaction"
      );
      expect(callArgs).toBeTruthy();
      const [, meta] = callArgs!;
      // The log must be structured: include operation, attempt, delayMs, endpoint.
      expect(meta).toMatchObject({
        operation: "simulateTransaction",
        endpoint: "rpc",
        attempt: 1,
        nextAttempt: 2,
      });
      // The original Error object MUST NOT be passed through to the log.
      // This guards against accidentally serializing sensitive stack frames.
      expect(meta).not.toBeInstanceOf(Error);
      expect(JSON.stringify(meta)).not.toContain("secret_key=SABCDEF");

      // Metrics: a transient retry counter was recorded for the operation.
      const snapshots = getRpcRetrySnapshots();
      const attemptSnap = snapshots.find(
        (s) => s.operation === "simulateTransaction" && s.outcome === "attempt",
      );
      expect(attemptSnap).toBeTruthy();
      expect(attemptSnap!.count).toBeGreaterThanOrEqual(1);
    });

    it("records the validation_error outcome when RequestValidationError is thrown", async () => {
      const operation = vi.fn().mockRejectedValue(
        new RequestValidationError("Invalid body"),
      );

      await expect(
        executeWithRetry(operation, {
          maxRetries: 3,
          initialDelayMs: 1,
          operation: "getAccount",
        }),
      ).rejects.toThrow(RequestValidationError);

      const outcomeSnap = getRpcRetrySnapshots().find(
        (s) => s.operation === "getAccount" && s.outcome === "validation_error",
      );
      expect(outcomeSnap).toBeTruthy();
      expect(outcomeSnap!.count).toBe(1);

      // No retry log should be emitted; validation errors fail fast.
      expect(warnSpy).toHaveBeenCalledWith(
        "RPC operation rejected before retrying",
        expect.objectContaining({ operation: "getAccount" }),
      );
    });

    it("records `exhausted` or `timeout` outcome when retries are burned", async () => {
      const operation = vi.fn().mockRejectedValue(new Error("Hard failure"));

      await expect(
        executeWithRetry(operation, {
          maxRetries: 2,
          initialDelayMs: 1,
          operation: "getEvents",
        }),
      ).rejects.toThrow("Hard failure");

      const snapshots = getRpcRetrySnapshots();
      const exhaustedSnap = snapshots.find(
        (s) => s.operation === "getEvents" && s.outcome === "exhausted",
      );
      expect(exhaustedSnap).toBeTruthy();
      expect(exhaustedSnap!.count).toBe(1);
      expect(getRpcRetryMaxAttemptsReachedTotal()).toBe(1);

      // The final log is at `error` level so dashboards can alert on it.
      expect(errorSpy).toHaveBeenCalledWith(
        "RPC retries exhausted",
        expect.objectContaining({ operation: "getEvents" }),
      );
    });

    it("records `timeout` outcome when the helper times out before the first response", async () => {
      const operation = vi.fn(
        () => new Promise((resolve) => setTimeout(() => resolve("late"), 250)),
      );

      await expect(
        executeWithRetry(operation, {
          maxRetries: 1,
          initialDelayMs: 1,
          timeoutMs: 40,
          operation: "simulateTransaction",
        }),
      ).rejects.toBeInstanceOf(RpcTimeoutError);

      const timeoutSnap = getRpcRetrySnapshots().find(
        (s) => s.operation === "simulateTransaction" && s.outcome === "timeout",
      );
      expect(timeoutSnap).toBeTruthy();
      expect(timeoutSnap!.count).toBe(1);
    });

    it("counts exactly one attempt per retryable call, including the first (no double-counting)", async () => {
      const before = getRpcRetryAttemptsTotal();

      const operation = vi.fn()
        .mockRejectedValueOnce(new Error("transient 1"))
        .mockRejectedValueOnce(new Error("transient 2"))
        .mockResolvedValue("ok");

      await executeWithRetry(operation, {
        initialDelayMs: 1,
        operation: "getLatestLedger",
      });

      const after = getRpcRetryAttemptsTotal();
      // Three attempts total: 2 transient failures + 1 success.
      expect(after - before).toBe(3);
    });

    it("records a success outcome so dashboards can compute success rate", async () => {
      resetRequestMetrics();
      const operation = vi.fn().mockResolvedValue("ok");

      await executeWithRetry(operation, {
        operation: "simulateTransaction",
      });

      const successSnap = getRpcRetrySnapshots().find(
        (s) => s.operation === "simulateTransaction" && s.outcome === "success",
      );
      expect(successSnap).toBeTruthy();
      expect(successSnap!.count).toBe(1);
    });

    it("scrubs secret-like substrings from logged error messages", async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error("Boom xdr=ABCDEFGHIJKLMNOP and secret_key=SK_SECRET_VALUE here"))
        .mockResolvedValue("ok");

      await executeWithRetry(operation, {
        initialDelayMs: 1,
        operation: "simulateTransaction",
      });

      for (const call of warnSpy.mock.calls) {
        if (typeof call[0] !== "string") continue;
        const serialized = JSON.stringify(call);
        // Original sensitive substring MUST NOT survive sanitization.
        expect(serialized).not.toContain("SK_SECRET_VALUE");
        expect(serialized).not.toContain("ABCDEFGHIJKLMNOP");
        // Sanitizer must have left a [REDACTED...] marker in its place.
        expect(serialized).toContain("[REDACTED");
        // The unredacted `secret_key=<value>` / `xdr=<value>` patterns must
        // not appear in the log payload. Brackets are excluded from the
        // test pattern so the [REDACTED...] marker does NOT count as a hit.
        expect(serialized).not.toMatch(new RegExp('secret[_]?key\\s*=\\s*"?[^"\\s,}\\[\\]]+"?', 'i'));
        expect(serialized).not.toMatch(/xdr\s*=\s*"?[A-Za-z0-9+/=]{12,}"?/i);
      }
    });

    it("scrubs raw Stellar secret seeds and 64-char hex strings", async () => {
      // Build a string with: S[A-Z2-7]{55} (Stellar secret seed) and 64 hex chars.
      const secretSeed = "S" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ".slice(0, 55);
      const hexBlob = "a".repeat(64);
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error(`Boom seed=${secretSeed} and hex=${hexBlob} here`))
        .mockResolvedValue("ok");

      await executeWithRetry(operation, {
        initialDelayMs: 1,
        operation: "simulateTransaction",
      });

      for (const call of warnSpy.mock.calls) {
        if (typeof call[0] !== "string") continue;
        const serialized = JSON.stringify(call);
        expect(serialized).not.toContain(secretSeed);
        expect(serialized).not.toContain(hexBlob);
      }
    });
  });
});

describe("Issue #1089: bounded retry budget", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetRequestMetrics();
    warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    errorSpy = vi.spyOn(logger, "error").mockImplementation(() => logger);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  function budgetFor(operation: string) {
    return getRpcRetryBudgetSnapshots().find((s) => s.operation === operation && s.endpoint === "rpc");
  }

  it("clamps requested budgets into [0, RPC_RETRY_BUDGET_MAX_RETRIES]", () => {
    expect(boundRetryBudget(2)).toBe(2);
    expect(boundRetryBudget(RPC_RETRY_BUDGET_MAX_RETRIES)).toBe(RPC_RETRY_BUDGET_MAX_RETRIES);
    expect(boundRetryBudget(50)).toBe(RPC_RETRY_BUDGET_MAX_RETRIES);
    expect(boundRetryBudget(-1)).toBe(0);
    expect(boundRetryBudget(2.9)).toBe(2);
    expect(boundRetryBudget(undefined)).toBe(3);
    expect(boundRetryBudget(Number.NaN)).toBe(3);
    expect(boundRetryBudget(Number.POSITIVE_INFINITY)).toBe(3);
  });

  it("never attempts more than the ceiling even when a caller asks for more", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("down"));

    await expect(
      executeWithRetry(operation, { maxRetries: 100, initialDelayMs: 1, operation: "getAccount" }),
    ).rejects.toThrow("down");

    expect(operation).toHaveBeenCalledTimes(RPC_RETRY_BUDGET_MAX_RETRIES + 1);
    expect(warnSpy).toHaveBeenCalledWith(
      "RPC retry budget clamped",
      expect.objectContaining({ operation: "getAccount", requestedMaxRetries: 100, appliedMaxRetries: RPC_RETRY_BUDGET_MAX_RETRIES }),
    );
    expect(budgetFor("getAccount")).toMatchObject({
      sequences: 1,
      retriesAllowed: RPC_RETRY_BUDGET_MAX_RETRIES,
      retriesUsed: RPC_RETRY_BUDGET_MAX_RETRIES,
      exhausted: 1,
    });
  });

  it("falls back to the default budget when maxRetries is explicitly undefined", async () => {
    const operation = vi.fn().mockResolvedValue("ok");

    await executeWithRetry(operation, { maxRetries: undefined, operation: "getLatestLedger" });

    // Previously `{ ...defaults, maxRetries: undefined }` skipped the loop
    // entirely and threw without ever calling the operation.
    expect(operation).toHaveBeenCalledTimes(1);
    expect(budgetFor("getLatestLedger")).toMatchObject({ sequences: 1, retriesAllowed: 3, retriesUsed: 0, exhausted: 0 });
  });

  it("records budget used on success without marking it exhausted", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValue("ok");

    await executeWithRetry(operation, { maxRetries: 3, initialDelayMs: 1, operation: "simulateTransaction" });
    await executeWithRetry(vi.fn().mockResolvedValue("ok"), { maxRetries: 3, operation: "simulateTransaction" });

    expect(budgetFor("simulateTransaction")).toEqual({
      operation: "simulateTransaction",
      endpoint: "rpc",
      sequences: 2,
      retriesAllowed: 6,
      retriesUsed: 1,
      exhausted: 0,
    });
  });

  it("counts a validation error as a finished sequence that used no retries", async () => {
    const operation = vi.fn().mockRejectedValue(new RequestValidationError("bad"));

    await expect(
      executeWithRetry(operation, { maxRetries: 2, initialDelayMs: 1, operation: "prepareTransaction" }),
    ).rejects.toThrow(RequestValidationError);

    expect(budgetFor("prepareTransaction")).toMatchObject({ sequences: 1, retriesAllowed: 2, retriesUsed: 0, exhausted: 0 });
  });

  it("marks the budget exhausted when the final attempt times out", async () => {
    const operation = vi.fn(() => new Promise((resolve) => setTimeout(() => resolve("late"), 200)));

    await expect(
      executeWithRetry(operation, { maxRetries: 1, initialDelayMs: 1, timeoutMs: 20, operation: "getEvents" }),
    ).rejects.toBeInstanceOf(RpcTimeoutError);

    expect(budgetFor("getEvents")).toMatchObject({ sequences: 1, retriesAllowed: 1, retriesUsed: 1, exhausted: 1 });
  });
});
