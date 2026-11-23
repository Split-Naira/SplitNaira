import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataSource } from "typeorm";

import { clearEnvCache } from "../config/env.js";
import {
  closeDatabase,
  getActiveTransactionCount,
  initDatabase,
  resetActiveTransactionCountForTests,
  withTransaction,
} from "./database.js";
import {
  drainActiveTransactions,
  runShutdownSequence,
} from "./shutdown.js";

const testEnv = {
  DATABASE_URL: "postgres://test:test@localhost:5432/splitnaira_test",
  HORIZON_URL: "https://horizon-testnet.stellar.org",
  SOROBAN_RPC_URL: "https://soroban-testnet.stellar.org",
  SOROBAN_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  CONTRACT_ID: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  SIMULATOR_ACCOUNT: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  NODE_ENV: "test",
};

function applyTestEnv(): void {
  for (const [key, value] of Object.entries(testEnv)) process.env[key] = value;
}

function clearTestEnv(): void {
  for (const key of Object.keys(testEnv)) delete process.env[key];
}

interface FakeQueryRunner {
  connect: ReturnType<typeof vi.fn>;
  startTransaction: ReturnType<typeof vi.fn>;
  commitTransaction: ReturnType<typeof vi.fn>;
  rollbackTransaction: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
}

async function initWithQueryRunner(queryRunner: FakeQueryRunner): Promise<void> {
  vi.spyOn(DataSource.prototype, "initialize").mockImplementation(async function (
    this: DataSource,
  ) {
    this.isInitialized = true;
    return this;
  });
  vi.spyOn(DataSource.prototype, "destroy").mockImplementation(async function (
    this: DataSource,
  ) {
    this.isInitialized = false;
  });
  vi.spyOn(DataSource.prototype, "createQueryRunner").mockReturnValue(
    queryRunner as unknown as ReturnType<DataSource["createQueryRunner"]>,
  );
  await initDatabase();
}

function fakeQueryRunner(): FakeQueryRunner {
  return {
    connect: vi.fn(),
    startTransaction: vi.fn(),
    commitTransaction: vi.fn(),
    rollbackTransaction: vi.fn(),
    release: vi.fn(),
  };
}

async function waitForActiveTransactions(count: number): Promise<void> {
  await vi.waitFor(() => expect(getActiveTransactionCount()).toBe(count));
}

beforeEach(async () => {
  applyTestEnv();
  clearEnvCache();
  await closeDatabase();
  resetActiveTransactionCountForTests();
});

afterEach(async () => {
  await closeDatabase();
  resetActiveTransactionCountForTests();
  vi.restoreAllMocks();
  clearEnvCache();
  clearTestEnv();
});

describe("bounded transaction draining (#1638)", () => {
  it("returns immediately when no transaction is active, even with a zero timeout", async () => {
    const sleep = vi.fn(async () => undefined);

    const result = await drainActiveTransactions({
      timeoutMs: 0,
      getActiveCount: () => 0,
      sleep,
    });

    expect(result).toEqual({ drained: true, remaining: 0, elapsedMs: 0 });
    expect(sleep).not.toHaveBeenCalled();
  });

  it("stops at the deadline instead of draining forever", async () => {
    let clock = 0;
    const sleep = vi.fn(async (ms: number) => {
      clock += ms;
    });

    const result = await drainActiveTransactions({
      timeoutMs: 100,
      pollIntervalMs: 40,
      getActiveCount: () => 2,
      now: () => clock,
      sleep,
    });

    expect(result).toEqual({ drained: false, remaining: 2, elapsedMs: 100 });
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([40, 40, 20]);
  });

  it("waits for an active transaction that commits", async () => {
    const queryRunner = fakeQueryRunner();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await initWithQueryRunner(queryRunner);

    const transaction = withTransaction(async () => {
      await gate;
      return "committed";
    });
    await waitForActiveTransactions(1);

    const drain = drainActiveTransactions({ timeoutMs: 500, pollIntervalMs: 5 });
    expect(getActiveTransactionCount()).toBe(1);

    release();

    await expect(transaction).resolves.toBe("committed");
    await expect(drain).resolves.toMatchObject({
      drained: true,
      remaining: 0,
    });
    expect(queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
    expect(getActiveTransactionCount()).toBe(0);
  });

  it("waits for an active transaction that rolls back", async () => {
    const queryRunner = fakeQueryRunner();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await initWithQueryRunner(queryRunner);

    const transaction = withTransaction(async () => {
      await gate;
      throw new Error("constraint violation");
    });
    await waitForActiveTransactions(1);

    const drain = drainActiveTransactions({ timeoutMs: 500, pollIntervalMs: 5 });
    release();

    await expect(transaction).rejects.toThrow("constraint violation");
    await expect(drain).resolves.toMatchObject({
      drained: true,
      remaining: 0,
    });
    expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
    expect(getActiveTransactionCount()).toBe(0);
  });

  it("times out with the transaction still open, then releases it", async () => {
    const queryRunner = fakeQueryRunner();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await initWithQueryRunner(queryRunner);

    const transaction = withTransaction(async () => {
      await gate;
      return "late";
    });
    await waitForActiveTransactions(1);

    const drain = await drainActiveTransactions({ timeoutMs: 20, pollIntervalMs: 5 });

    expect(drain).toEqual({ drained: false, remaining: 1, elapsedMs: drain.elapsedMs });
    expect(drain.elapsedMs).toBeGreaterThanOrEqual(20);
    expect(getActiveTransactionCount()).toBe(1);

    release();
    await expect(transaction).resolves.toBe("late");
    expect(getActiveTransactionCount()).toBe(0);
  });
});

describe("shutdown sequence (#1638)", () => {
  it("drains transactions before closing the database and exits cleanly", async () => {
    const order: string[] = [];
    const forceExit = vi.fn();

    const result = await runShutdownSequence(
      {
        markShuttingDown: () => order.push("readiness"),
        closeSseConnections: () => order.push("sse"),
        stopEventListener: () => order.push("listener"),
        closeServer: async () => {
          order.push("server-close-start");
        },
        drainTransactions: async () => {
          order.push("drain-transactions");
          return { drained: true, remaining: 0, elapsedMs: 3 };
        },
        closeDatabase: async () => {
          order.push("database-close");
        },
        forceExit,
      },
      { drainTimeoutMs: 100, forceTimeoutMs: 1_000 },
    );

    expect(order).toEqual([
      "readiness",
      "sse",
      "listener",
      "server-close-start",
      "drain-transactions",
      "database-close",
    ]);
    expect(result).toMatchObject({ exitCode: 0, forced: false });
    expect(forceExit).toHaveBeenCalledWith(0);
  });

  it("exits 1 when the drain deadline passes but shutdown still completes", async () => {
    const log = vi.fn();
    const forceExit = vi.fn();

    const result = await runShutdownSequence(
      {
        markShuttingDown: vi.fn(),
        closeSseConnections: vi.fn(),
        stopEventListener: vi.fn(),
        closeServer: async () => undefined,
        drainTransactions: async () => ({
          drained: false,
          remaining: 1,
          elapsedMs: 50,
        }),
        closeDatabase: vi.fn(async () => undefined),
        forceExit,
        log,
      },
      { drainTimeoutMs: 50, forceTimeoutMs: 1_000 },
    );

    expect(result).toMatchObject({ exitCode: 1, forced: false });
    expect(forceExit).toHaveBeenCalledWith(1);
    expect(log).toHaveBeenCalledWith(
      "warn",
      "Timed out draining active database transactions",
      expect.objectContaining({ remaining: 1, drainTimeoutMs: 50 }),
    );
  });

  it("force-terminates with exit 1 when a close step hangs", async () => {
    const forceExit = vi.fn();

    const result = await runShutdownSequence(
      {
        markShuttingDown: vi.fn(),
        closeSseConnections: vi.fn(),
        stopEventListener: vi.fn(),
        // Simulates a connection that never finishes, so server.close() never
        // resolves on its own.
        closeServer: () => new Promise<void>(() => undefined),
        drainTransactions: async () => ({
          drained: true,
          remaining: 0,
          elapsedMs: 1,
        }),
        closeDatabase: vi.fn(async () => undefined),
        forceExit,
      },
      { drainTimeoutMs: 100, forceTimeoutMs: 20 },
    );

    expect(result).toMatchObject({ exitCode: 1, forced: true });
    expect(forceExit).toHaveBeenCalledTimes(1);
    expect(forceExit).toHaveBeenCalledWith(1);
  });
});
