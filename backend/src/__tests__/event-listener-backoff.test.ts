/**
 * EventListenerService resilience tests (Issue #627)
 *
 * Verifies the Stellar RPC outage handling:
 *  - poll interval backs off to 30s after 3 consecutive errors,
 *  - the interval resets to 5s on the first successful poll after a streak,
 *  - getServiceHealth() reflects status / consecutiveErrors / lastSuccessfulPoll,
 *  - the catch-up window is capped at MAX_CATCHUP_LEDGERS.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Shared mock handles, hoisted so the vi.mock factories below can close over them.
const mocks = vi.hoisted(() => {
  const getEvents = vi.fn();
  const getLatestLedger = vi.fn(async () => ({ sequence: 1000 }));
  return {
    getEvents,
    getLatestLedger,
    repo: {
      findOneBy: vi.fn(async () => null),
      create: vi.fn((x: unknown) => x),
      upsert: vi.fn(async () => undefined),
    },
  };
});

vi.mock("../services/stellar.js", () => ({
  getStellarRpcServer: () => ({
    getEvents: mocks.getEvents,
    getLatestLedger: mocks.getLatestLedger,
  }),
  // Pass-through so the wrapped call's success/failure propagates directly.
  executeWithRetry: <T>(fn: () => Promise<T>) => fn(),
  loadStellarConfig: () => ({ contractId: "CONTRACT" }),
}));

vi.mock("../services/database.js", () => ({
  getDataSource: () => ({ getRepository: () => mocks.repo }),
}));

vi.mock("../services/splits.service.js", () => ({
  fetchProjectById: vi.fn(async () => ({ token: "Native" })),
}));

vi.mock("../services/SseEventBus.js", () => ({
  publishSseEvent: vi.fn(),
}));

vi.mock("@stellar/stellar-sdk", () => ({
  scValToNative: (v: unknown) => v,
}));

vi.mock("../services/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

type ListenerModule = typeof import("../services/EventListenerService.js");

async function freshModule(): Promise<ListenerModule> {
  vi.resetModules();
  return import("../services/EventListenerService.js");
}

function lastIntervalDelay(spy: ReturnType<typeof vi.spyOn>): number | undefined {
  const calls = spy.mock.calls;
  if (calls.length === 0) return undefined;
  return calls[calls.length - 1][1] as number;
}

let mod: ListenerModule;
let setIntervalSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  mocks.getEvents.mockReset();
  mocks.getLatestLedger.mockReset().mockResolvedValue({ sequence: 1000 });
  setIntervalSpy = vi.spyOn(globalThis, "setInterval");
  mod = await freshModule();
});

afterEach(() => {
  mod.stopEventListenerService();
  setIntervalSpy.mockRestore();
});

describe("EventListenerService - RPC outage back-off", () => {
  it("starts healthy at the normal 5s cadence", async () => {
    mocks.getEvents.mockResolvedValue({ events: [] });
    await mod.startEventListenerService();

    expect(lastIntervalDelay(setIntervalSpy)).toBe(mod.NORMAL_POLL_INTERVAL_MS);
    expect(mod.getServiceHealth().status).toBe("healthy");
    expect(mod.getServiceHealth().consecutiveErrors).toBe(0);
  });

  it("backs off to 30s after 3 consecutive errors", async () => {
    mocks.getEvents.mockRejectedValue(new Error("RPC down"));
    await mod.startEventListenerService();

    await mod.pollEvents();
    expect(mod.getServiceHealth().consecutiveErrors).toBe(1);
    expect(mod.getServiceHealth().status).toBe("healthy"); // not degraded yet

    await mod.pollEvents();
    expect(mod.getServiceHealth().consecutiveErrors).toBe(2);

    await mod.pollEvents();
    expect(mod.getServiceHealth().consecutiveErrors).toBe(3);
    expect(mod.getServiceHealth().status).toBe("degraded");
    expect(lastIntervalDelay(setIntervalSpy)).toBe(mod.BACKOFF_POLL_INTERVAL_MS);
  });

  it("resets the interval to 5s on the first successful poll after a streak", async () => {
    mocks.getEvents.mockRejectedValue(new Error("RPC down"));
    await mod.startEventListenerService();

    await mod.pollEvents();
    await mod.pollEvents();
    await mod.pollEvents();
    expect(lastIntervalDelay(setIntervalSpy)).toBe(mod.BACKOFF_POLL_INTERVAL_MS);

    // Recovery.
    mocks.getEvents.mockResolvedValue({ events: [] });
    await mod.pollEvents();

    expect(lastIntervalDelay(setIntervalSpy)).toBe(mod.NORMAL_POLL_INTERVAL_MS);
    expect(mod.getServiceHealth().status).toBe("healthy");
    expect(mod.getServiceHealth().consecutiveErrors).toBe(0);
    expect(mod.getServiceHealth().lastSuccessfulPoll).not.toBeNull();
  });

  it("reports 'stopped' before start and after stop", async () => {
    expect(mod.getServiceHealth().status).toBe("stopped");

    mocks.getEvents.mockResolvedValue({ events: [] });
    await mod.startEventListenerService();
    expect(mod.getServiceHealth().status).toBe("healthy");

    mod.stopEventListenerService();
    expect(mod.getServiceHealth().status).toBe("stopped");
  });
});

describe("EventListenerService - catch-up window cap", () => {
  it("caps a far-behind start ledger to MAX_CATCHUP_LEDGERS behind tip", () => {
    const tip = 500_000;
    const capped = mod.capCatchUpWindow(tip, tip - 50_000);
    expect(capped).toBe(tip - mod.MAX_CATCHUP_LEDGERS);
  });

  it("leaves a recent start ledger unchanged", () => {
    const tip = 500_000;
    const desired = tip - 100;
    expect(mod.capCatchUpWindow(tip, desired)).toBe(desired);
  });
});
