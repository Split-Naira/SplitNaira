import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWalletState } from "./useWallet";
import * as walletLib from "../lib/wallet";

const ADDR_A = "GA7FYRB5V3AP6P2RROT2P6KRSZ3K6QI6W3Y6KX2X7HX6Q5Y6KX2X7HX6";
const ADDR_B = "GCXKG6RN4ON6MJG5VQZ2KQ3X4Y5P6Q7R8A9B0C1D2E3F4G5H6I7J8K9L0M";

vi.mock("../lib/wallet", () => ({
  getWalletState: vi.fn(),
  connectWallet: vi.fn(),
}));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("wallet account switch", () => {
  it("reports failed connect actions to callers", async () => {
    vi.mocked(walletLib.getWalletState).mockResolvedValue({
      connected: false,
      address: null,
      network: null,
    });
    vi.mocked(walletLib.connectWallet).mockRejectedValue(new Error("Wallet unavailable"));

    const { result } = renderHook(() => useWalletState());

    let didConnect = true;
    await act(async () => {
      didConnect = await result.current.connect();
    });

    expect(didConnect).toBe(false);
    expect(result.current.error).toBe("Wallet unavailable");
  });

  it("resets and refreshes when poll detects a different address", async () => {
    vi.mocked(walletLib.getWalletState).mockResolvedValue({
      connected: true,
      address: ADDR_A,
      network: "TESTNET",
    });

    const { result } = renderHook(() => useWalletState());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(result.current.wallet.address).toBe(ADDR_A);

    vi.mocked(walletLib.getWalletState).mockResolvedValue({
      connected: true,
      address: ADDR_B,
      network: "TESTNET",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(result.current.wallet.address).toBe(ADDR_B);
    expect(result.current.loading).toBe(false);
  });

  it("does not reset when address stays the same across polls", async () => {
    vi.mocked(walletLib.getWalletState).mockResolvedValue({
      connected: true,
      address: ADDR_A,
      network: "TESTNET",
    });

    const { result } = renderHook(() => useWalletState());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(result.current.wallet.address).toBe(ADDR_A);
    const callCount = vi.mocked(walletLib.getWalletState).mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });

    expect(vi.mocked(walletLib.getWalletState).mock.calls.length).toBeGreaterThanOrEqual(callCount + 1);
    expect(result.current.wallet.address).toBe(ADDR_A);
    expect(result.current.error).toBeNull();
  });

  it("polls every 2 seconds while connected", async () => {
    vi.mocked(walletLib.getWalletState).mockResolvedValue({
      connected: true,
      address: ADDR_A,
      network: "TESTNET",
    });

    renderHook(() => useWalletState());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    const callsAfterMount = vi.mocked(walletLib.getWalletState).mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });

    expect(vi.mocked(walletLib.getWalletState).mock.calls.length).toBeGreaterThanOrEqual(callsAfterMount + 1);
  });

  it("does not poll when wallet is not connected", async () => {
    vi.mocked(walletLib.getWalletState).mockResolvedValue({
      connected: false,
      address: null,
      network: null,
    });

    renderHook(() => useWalletState());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    const callsAfterMount = vi.mocked(walletLib.getWalletState).mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });

    // No additional calls from polling (only initial mount refresh)
    expect(vi.mocked(walletLib.getWalletState).mock.calls.length).toBe(callsAfterMount);
  });

  it("detects reconnection after an error via poll", async () => {
    // Initial state: connected
    vi.mocked(walletLib.getWalletState).mockResolvedValue({
      connected: true,
      address: ADDR_A,
      network: "TESTNET",
    });

    const { result } = renderHook(() => useWalletState());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(result.current.wallet.address).toBe(ADDR_A);

    // Poll discovers different address
    vi.mocked(walletLib.getWalletState).mockResolvedValue({
      connected: true,
      address: ADDR_B,
      network: "TESTNET",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(result.current.wallet.address).toBe(ADDR_B);
  });
});
