/**
 * withTransaction coverage for nested and wrapper-level failures (Issue #1091).
 *
 * Each createQueryRunner() call returns a fresh fake runner that records its
 * own lifecycle, so tests can assert what happened to the outer and inner
 * transactions separately.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataSource, QueryRunner } from "typeorm";

import { setDataSourceForTests, withTransaction } from "../services/database.js";
import { logger } from "../services/logger.js";

type Outcome = "open" | "committed" | "rolled_back";

interface FakeRunner {
  id: number;
  outcome: Outcome;
  released: boolean;
  connect: ReturnType<typeof vi.fn>;
  startTransaction: ReturnType<typeof vi.fn>;
  commitTransaction: ReturnType<typeof vi.fn>;
  rollbackTransaction: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
  manager: Record<string, never>;
}

let runners: FakeRunner[];
let activeConnections: number;
let maxConnections: number;
/** Applied to each runner as it is created, to inject failures. */
let configureRunner: (runner: FakeRunner) => void;

function createFakeRunner(): FakeRunner {
  const runner: FakeRunner = {
    id: runners.length,
    outcome: "open",
    released: false,
    connect: vi.fn(async () => {
      activeConnections++;
      maxConnections = Math.max(maxConnections, activeConnections);
    }),
    startTransaction: vi.fn(async () => undefined),
    commitTransaction: vi.fn(async () => {
      runner.outcome = "committed";
    }),
    rollbackTransaction: vi.fn(async () => {
      runner.outcome = "rolled_back";
    }),
    release: vi.fn(async () => {
      runner.released = true;
      activeConnections--;
    }),
    manager: {},
  };
  runners.push(runner);
  configureRunner(runner);
  return runner;
}

function deadlockError(): Error {
  return Object.assign(new Error("deadlock detected"), { code: "40P01" });
}

beforeEach(() => {
  runners = [];
  activeConnections = 0;
  maxConnections = 0;
  configureRunner = () => undefined;
  setDataSourceForTests({
    isInitialized: true,
    createQueryRunner: vi.fn(() => createFakeRunner() as unknown as QueryRunner),
  } as unknown as DataSource);
});

afterEach(() => {
  setDataSourceForTests(null);
  vi.restoreAllMocks();
});

describe("withTransaction nested failures (Issue #1091)", () => {
  it("rolls back both levels and rethrows the inner error when it is not caught", async () => {
    const innerError = new Error("inner write failed");

    const result = withTransaction(async () => {
      await withTransaction(async () => {
        throw innerError;
      });
      return "unreachable";
    });

    await expect(result).rejects.toBe(innerError);
    const [outer, inner] = runners;
    expect(inner.outcome).toBe("rolled_back");
    expect(outer.outcome).toBe("rolled_back");
    expect(outer.commitTransaction).not.toHaveBeenCalled();
    expect(runners.every((r) => r.released)).toBe(true);
    expect(activeConnections).toBe(0);
  });

  it("lets the outer transaction commit when it catches the inner failure", async () => {
    const result = await withTransaction(async () => {
      try {
        await withTransaction(async () => {
          throw new Error("optional side write failed");
        });
      } catch {
        // swallowed deliberately
      }
      return "outer-ok";
    });

    expect(result).toBe("outer-ok");
    const [outer, inner] = runners;
    expect(inner.outcome).toBe("rolled_back");
    expect(outer.outcome).toBe("committed");
    expect(activeConnections).toBe(0);
  });

  it("keeps an inner commit when the outer transaction later fails (no savepoint semantics)", async () => {
    const outerError = new Error("outer failed after inner committed");

    await expect(
      withTransaction(async () => {
        await withTransaction(async () => "inner-ok");
        throw outerError;
      })
    ).rejects.toBe(outerError);

    const [outer, inner] = runners;
    // Documented limitation: the inner call is an independent transaction.
    expect(inner.outcome).toBe("committed");
    expect(outer.outcome).toBe("rolled_back");
    expect(activeConnections).toBe(0);
  });

  it("checks out a separate connection per nesting level", async () => {
    await withTransaction(async (outerRunner) => {
      await withTransaction(async (innerRunner) => {
        expect(innerRunner).not.toBe(outerRunner);
        expect(activeConnections).toBe(2);
      });
    });

    expect(maxConnections).toBe(2);
    expect(activeConnections).toBe(0);
  });

  it("retries an inner deadlock without re-running the outer callback", async () => {
    const outerCallback = vi.fn();
    let innerAttempts = 0;

    const result = await withTransaction(async () => {
      outerCallback();
      return withTransaction(async () => {
        innerAttempts++;
        if (innerAttempts === 1) throw deadlockError();
        return "inner-recovered";
      });
    });

    expect(result).toBe("inner-recovered");
    expect(outerCallback).toHaveBeenCalledTimes(1);
    expect(innerAttempts).toBe(2);
    // outer + failed inner attempt + successful inner retry
    expect(runners.map((r) => r.outcome)).toEqual(["committed", "rolled_back", "committed"]);
    expect(activeConnections).toBe(0);
  });

  it("propagates the inner error to the outer level even when the inner rollback fails", async () => {
    const innerError = new Error("inner write failed");
    const logSpy = vi.spyOn(logger, "error").mockImplementation(() => logger);
    configureRunner = (runner) => {
      if (runner.id === 1) {
        runner.rollbackTransaction.mockRejectedValue(new Error("connection lost during rollback"));
      }
    };

    await expect(
      withTransaction(async () => {
        await withTransaction(async () => {
          throw innerError;
        });
      })
    ).rejects.toBe(innerError);

    const [outer, inner] = runners;
    expect(inner.released).toBe(true);
    expect(outer.outcome).toBe("rolled_back");
    expect(logSpy).toHaveBeenCalledWith(
      "Transaction rollback failed",
      expect.objectContaining({ originalError: innerError })
    );
  });
});

describe("withTransaction wrapper-level failures (Issue #1091)", () => {
  it("rethrows the callback error, not the rollback error, when rollback fails", async () => {
    const callbackError = new Error("constraint violation");
    vi.spyOn(logger, "error").mockImplementation(() => logger);
    configureRunner = (runner) => {
      runner.rollbackTransaction.mockRejectedValue(new Error("rollback failed"));
    };

    await expect(
      withTransaction(async () => {
        throw callbackError;
      })
    ).rejects.toBe(callbackError);
    expect(runners[0].released).toBe(true);
  });

  it("still retries a deadlock when the rollback of the failed attempt also fails", async () => {
    vi.spyOn(logger, "error").mockImplementation(() => logger);
    configureRunner = (runner) => {
      if (runner.id === 0)
        runner.rollbackTransaction.mockRejectedValue(new Error("rollback failed"));
    };
    let attempts = 0;

    const result = await withTransaction(async () => {
      attempts++;
      if (attempts === 1) throw deadlockError();
      return "recovered";
    });

    expect(result).toBe("recovered");
    expect(runners).toHaveLength(2);
    expect(runners.every((r) => r.released)).toBe(true);
  });

  it("releases the connection and skips the callback when startTransaction fails", async () => {
    const startError = new Error("could not start transaction");
    const callback = vi.fn();
    configureRunner = (runner) => runner.startTransaction.mockRejectedValue(startError);

    await expect(withTransaction(callback)).rejects.toBe(startError);

    expect(callback).not.toHaveBeenCalled();
    expect(runners[0].released).toBe(true);
    expect(runners[0].rollbackTransaction).not.toHaveBeenCalled();
    expect(activeConnections).toBe(0);
  });

  it("releases the runner and skips the callback when connect fails", async () => {
    const connectError = new Error("pool timeout");
    const callback = vi.fn();
    configureRunner = (runner) => {
      runner.connect.mockRejectedValue(connectError);
      runner.release.mockImplementation(async () => {
        runner.released = true;
      });
    };

    await expect(withTransaction(callback)).rejects.toBe(connectError);

    expect(callback).not.toHaveBeenCalled();
    expect(runners[0].released).toBe(true);
  });

  it("rolls back and rethrows when commit fails", async () => {
    const commitError = new Error("could not serialize access");
    configureRunner = (runner) => runner.commitTransaction.mockRejectedValue(commitError);

    await expect(withTransaction(async () => "never-committed")).rejects.toBe(commitError);

    expect(runners[0].rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(runners[0].released).toBe(true);
  });

  it("returns the committed result when release fails afterwards", async () => {
    const logSpy = vi.spyOn(logger, "error").mockImplementation(() => logger);
    configureRunner = (runner) => runner.release.mockRejectedValue(new Error("release failed"));

    await expect(withTransaction(async () => "committed-value")).resolves.toBe("committed-value");

    expect(runners[0].outcome).toBe("committed");
    expect(logSpy).toHaveBeenCalledWith("Failed to release query runner", expect.any(Object));
  });

  it("rethrows the callback error when release also fails", async () => {
    const callbackError = new Error("callback failed");
    vi.spyOn(logger, "error").mockImplementation(() => logger);
    configureRunner = (runner) => runner.release.mockRejectedValue(new Error("release failed"));

    await expect(
      withTransaction(async () => {
        throw callbackError;
      })
    ).rejects.toBe(callbackError);
  });
});
