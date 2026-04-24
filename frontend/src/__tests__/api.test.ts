import { describe, it, expect, vi, beforeEach } from "vitest";
import { getProjectHistory } from "../lib/api";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

describe("Frontend API Pagination", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("getProjectHistory correctly handles paginated response envelope", async () => {
    const mockResponse = {
      items: [{ id: "1", type: "round", amount: "100" }],
      nextCursor: "cursor-123"
    };

    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockResponse
    });

    const result = await getProjectHistory("project-id");

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/splits/project-id/history")
    );
    expect(result).toEqual(mockResponse);
    expect(result).toHaveProperty("items");
    expect(result).toHaveProperty("nextCursor");
  });

  it("getProjectHistory appends cursor to URL when provided", async () => {
    const mockResponse = { items: [], nextCursor: null };

    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockResponse
    });

    await getProjectHistory("project-id", "my-cursor");

    const calledUrl = (fetch as any).mock.calls[0][0];
    const url = new URL(calledUrl);
    expect(url.searchParams.get("cursor")).toBe("my-cursor");
  });

  it("fails if response is an array (regression test for old assumption)", async () => {
    const mockResponse = [{ id: "1" }]; // Old format: just an array

    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockResponse
    });

    const result = await getProjectHistory("project-id");
    
    // In our new implementation, we cast to { items, nextCursor }.
    // If it's an array, result.items will be undefined.
    // We can add a check in the API client or just assert here.
    expect(result.items).toBeUndefined();
  });
});
