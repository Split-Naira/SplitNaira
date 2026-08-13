import { describe, it, expect, vi, beforeEach } from "vitest";
import { getProjectHistory } from "../lib/api";

describe("Frontend API Pagination", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("getProjectHistory correctly handles paginated response envelope", async () => {
    const mockResponse = {
      items: [{ id: "1", type: "round", amount: "100" }],
      nextCursor: "cursor-123"
    };

    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockResponse
    } as Response);

    const result = await getProjectHistory("project-id");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/splits/project-id/history"),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(result).toEqual(mockResponse);
    expect(result).toHaveProperty("items");
    expect(result).toHaveProperty("nextCursor");
  });

  it("getProjectHistory appends cursor to URL when provided", async () => {
    const mockResponse = { items: [], nextCursor: null };

    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockResponse
    } as Response);

    await getProjectHistory("project-id", "my-cursor");

    const calledUrl = String(mockFetch.mock.calls[0][0]);
    const url = new URL(calledUrl);
    expect(url.searchParams.get("cursor")).toBe("my-cursor");
  });

  it("fails if response is an array (regression test for old assumption)", async () => {
    const mockResponse = [{ id: "1" }]; // Old format: just an array

    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockResponse
    } as Response);

    const result = await getProjectHistory("project-id");

    expect(result.items).toBeUndefined();
  });
});
