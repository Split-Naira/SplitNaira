import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginRpcCall,
  classifyShutdownAwareFailure,
  endRpcCall,
  getInflightRpcCount,
  isRpcShutdownInProgress,
  outcomeForAbortedCall,
  resetRpcInflightForTests,
  shutdownRpcInflight,
} from "../rpc-inflight-shutdown.js";

afterEach(() => {
  resetRpcInflightForTests();
});

describe("RPC in-flight shutdown (#1639)", () => {
  it("tracks in-flight calls and clears on end", () => {
    const a = beginRpcCall(60_000);
    const b = beginRpcCall(60_000);
    expect(getInflightRpcCount()).toBe(2);
    endRpcCall(a.id);
    expect(getInflightRpcCount()).toBe(1);
    endRpcCall(b.id);
    expect(getInflightRpcCount()).toBe(0);
  });

  it("aborts in-flight signals and clears timers on shutdown", () => {
    const handle = beginRpcCall(60_000);
    expect(handle.signal.aborted).toBe(false);
    const { aborted } = shutdownRpcInflight();
    expect(aborted).toBe(1);
    expect(handle.signal.aborted).toBe(true);
    expect(getInflightRpcCount()).toBe(0);
    expect(isRpcShutdownInProgress()).toBe(true);
  });

  it("rejects new work after shutdown with already-aborted signal", () => {
    shutdownRpcInflight();
    const handle = beginRpcCall();
    expect(handle.signal.aborted).toBe(true);
  });

  it("classifies shutdown abort as unknown-outcome (timeout kind)", () => {
    const err = new DOMException("The operation was aborted", "AbortError");
    expect(classifyShutdownAwareFailure(err)).toBe("timeout");
    expect(outcomeForAbortedCall()).toBe("aborted_shutdown");
  });

  it("preserves permanent classification for terminal tx errors", () => {
    expect(classifyShutdownAwareFailure(new Error("tx_bad_seq"))).toBe("permanent");
  });

  it("fires timeout abort when budget elapses (boundary)", async () => {
    vi.useFakeTimers();
    const handle = beginRpcCall(100);
    expect(handle.signal.aborted).toBe(false);
    vi.advanceTimersByTime(100);
    expect(handle.signal.aborted).toBe(true);
    vi.useRealTimers();
  });
});
