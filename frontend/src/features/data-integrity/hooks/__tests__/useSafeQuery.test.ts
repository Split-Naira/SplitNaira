import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSafeQuery } from "../useSafeQuery";

vi.mock("../api/safeFetch", () => ({
  safeFetch: vi.fn(),
}));

import { safeFetch } from "../api/safeFetch";

describe("useSafeQuery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns initial loading state", () => {
    vi.mocked(safeFetch).mockImplementation(() => new Promise(() => {}));
    
    const { result } = renderHook(() => useSafeQuery("/api/test"));
    
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("returns data on successful fetch", async () => {
    vi.mocked(safeFetch).mockResolvedValue({ items: [] });
    
    const { result } = renderHook(() => useSafeQuery("/api/test"));
    
    await vi.runAllTimersAsync();
    
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toEqual({ items: [] });
    expect(result.current.error).toBeNull();
  });

  it("returns error on failed fetch", async () => {
    vi.mocked(safeFetch).mockRejectedValue(new Error("Network error"));
    
    const { result } = renderHook(() => useSafeQuery("/api/test"));
    
    await vi.runAllTimersAsync();
    
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe("Network error");
    expect(result.current.isStale).toBe(false);
  });

  it("sets isStale when refetch fails after data exists", async () => {
    vi.mocked(safeFetch).mockResolvedValueOnce({ items: [] });
    
    const { result, rerender } = renderHook(
      ({ url }) => useSafeQuery(url),
      { initialProps: { url: "/api/test" } }
    );
    
    await vi.runAllTimersAsync();
    expect(result.current.data).toEqual({ items: [] });
    
    vi.mocked(safeFetch).mockRejectedValue(new Error("Network error"));
    rerender({ url: "/api/test" });
    
    await vi.runAllTimersAsync();
    
    expect(result.current.isStale).toBe(true);
    expect(result.current.data).toEqual({ items: [] });
  });

  it("retry function re-fetches data", async () => {
    vi.mocked(safeFetch).mockResolvedValueOnce({ items: [] });
    
    const { result } = renderHook(() => useSafeQuery("/api/test"));
    
    await vi.runAllTimersAsync();
    expect(safeFetch).toHaveBeenCalledTimes(1);
    
    vi.mocked(safeFetch).mockResolvedValueOnce({ items: [1, 2, 3] });
    result.current.retry();
    
    await vi.runAllTimersAsync();
    
    expect(safeFetch).toHaveBeenCalledTimes(2);
    expect(result.current.data).toEqual({ items: [1, 2, 3] });
  });
});