/**
 * Frontend API Evolution tests (#528)
 *
 * Validates:
 *  - ApiError classification (status codes, helpers, code extraction)
 *  - Smart retry: 4xx errors are NOT retried; 5xx and network errors ARE
 *  - Sentry tagging includes httpStatus and errorCode for ApiErrors
 *  - Backward-compatible response mapping (camelCase ↔ snake_case)
 *  - Timeout behaviour
 *  - listProjects query-string construction
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { ApiClient, ApiError } from "../lib/api-client";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  init: vi.fn(),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockFetchOnce(status: number, body: unknown) {
  vi.mocked(fetch).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

function mockFetchAlways(status: number, body: unknown) {
  vi.mocked(fetch).mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ApiError — classification helpers", () => {
  it("isClientError is true for 4xx", () => {
    expect(new ApiError(400, "bad request").isClientError).toBe(true);
    expect(new ApiError(404, "not found").isClientError).toBe(true);
    expect(new ApiError(422, "unprocessable").isClientError).toBe(true);
  });

  it("isServerError is true for 5xx", () => {
    expect(new ApiError(500, "internal").isServerError).toBe(true);
    expect(new ApiError(503, "unavailable").isServerError).toBe(true);
  });

  it("isNotFound is true only for 404", () => {
    expect(new ApiError(404, "not found").isNotFound).toBe(true);
    expect(new ApiError(400, "bad request").isNotFound).toBe(false);
  });

  it("isUnauthorized is true for 401 and 403", () => {
    expect(new ApiError(401, "unauthorized").isUnauthorized).toBe(true);
    expect(new ApiError(403, "forbidden").isUnauthorized).toBe(true);
    expect(new ApiError(404, "not found").isUnauthorized).toBe(false);
  });

  it("name is ApiError", () => {
    expect(new ApiError(400, "bad").name).toBe("ApiError");
  });

  it("preserves the error code from the server response", () => {
    const err = new ApiError(400, "validation failed", "validation_error");
    expect(err.code).toBe("validation_error");
  });
});

describe("ApiClient — error body parsing", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.clearAllMocks();
  });

  it("extracts message from JSON error body", async () => {
    mockFetchAlways(400, { message: "Project ID already exists", error: "project_exists" });
    const client = new ApiClient("http://localhost", 1000);

    await expect(client.buildCreateSplitXdr({
      owner: "G".padEnd(56, "A"),
      projectId: "p1",
      title: "T",
      projectType: "music",
      token: "G".padEnd(56, "A"),
      collaborators: [],
    })).rejects.toMatchObject({
      message: "Project ID already exists",
      code: "project_exists",
      status: 400,
    });
  });

  it("falls back to status-based message when body has no message field", async () => {
    mockFetchAlways(500, { detail: "something broke" });
    const client = new ApiClient("http://localhost", 1000);

    await expect(client.getAdminStatus()).rejects.toMatchObject({
      status: 500,
      message: expect.stringContaining("500"),
    });
  });

  it("throws ApiError (not plain Error) for non-2xx responses", async () => {
    mockFetchAlways(404, { message: "not found" });
    const client = new ApiClient("http://localhost", 1000);

    try {
      await client.getSplit("missing-project");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
    }
  });
});

describe("ApiClient — smart retry (4xx not retried, 5xx retried)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.clearAllMocks();
  });

  it("does NOT retry on 400 Bad Request", async () => {
    mockFetchAlways(400, { message: "bad request" });
    const client = new ApiClient("http://localhost", 1000);

    await expect(client.getAdminStatus()).rejects.toBeInstanceOf(ApiError);
    // Should only be called once — no retries for 4xx
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on 404 Not Found", async () => {
    mockFetchAlways(404, { message: "not found" });
    const client = new ApiClient("http://localhost", 1000);

    await expect(client.getSplit("no-such-project")).rejects.toBeInstanceOf(ApiError);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on 401 Unauthorized", async () => {
    mockFetchAlways(401, { message: "unauthorized" });
    const client = new ApiClient("http://localhost", 1000);

    await expect(client.getAdminStatus()).rejects.toBeInstanceOf(ApiError);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("retries up to 3 times on 500 Server Error", async () => {
    mockFetchAlways(500, { message: "internal server error" });
    const client = new ApiClient("http://localhost", 1000);

    await expect(client.getAdminStatus()).rejects.toBeInstanceOf(ApiError);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
  });

  it("retries on network failure (no response)", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Network failure"));
    const client = new ApiClient("http://localhost", 100);

    await expect(client.getAdminTokenCount()).rejects.toThrow("Network failure");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
  });

  it("succeeds when a retry attempt recovers from a 500", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ message: "err" }) } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ admin: null, isPaused: false }) } as Response);

    const client = new ApiClient("http://localhost", 1000);
    const result = await client.getAdminStatus();

    expect(result).toEqual({ admin: null, isPaused: false });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });
});

describe("ApiClient — Sentry tagging for ApiError", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.clearAllMocks();
  });

  it("includes httpStatus and errorCode tags in Sentry capture for ApiError", async () => {
    mockFetchAlways(400, { message: "validation failed", error: "validation_error" });
    const client = new ApiClient("http://localhost", 1000);

    await expect(client.getAdminStatus()).rejects.toBeInstanceOf(ApiError);

    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(ApiError),
      expect.objectContaining({
        tags: expect.objectContaining({
          section: "api-client",
          httpStatus: "400",
          errorCode: "validation_error",
        }),
      }),
    );
  });

  it("does NOT call Sentry when request succeeds", async () => {
    mockFetchOnce(200, { admin: null, isPaused: false });
    const client = new ApiClient("http://localhost", 1000);

    await client.getAdminStatus();

    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});

describe("ApiClient — response mapping (camelCase / snake_case compatibility)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.clearAllMocks();
  });

  it("maps snake_case project fields to camelCase", async () => {
    mockFetchOnce(200, {
      project_id: "proj-1",
      title: "My Project",
      project_type: "music",
      token: "G".padEnd(56, "A"),
      owner: "G".padEnd(56, "B"),
      locked: false,
      balance: "1000",
      total_distributed: "500",
      distribution_round: 2,
      collaborators: [{ address: "G".padEnd(56, "C"), alias: "Alice", basis_points: 5000 }],
    });

    const client = new ApiClient("http://localhost", 1000);
    const project = await client.getSplit("proj-1");

    expect(project.projectId).toBe("proj-1");
    expect(project.projectType).toBe("music");
    expect(project.totalDistributed).toBe("500");
    expect(project.distributionRound).toBe(2);
    expect(project.collaborators[0].basisPoints).toBe(5000);
  });

  it("handles camelCase project fields (already normalized)", async () => {
    mockFetchOnce(200, {
      projectId: "proj-2",
      title: "Camel Project",
      projectType: "film",
      token: "G".padEnd(56, "A"),
      owner: "G".padEnd(56, "B"),
      locked: true,
      balance: "0",
      totalDistributed: "200",
      distributionRound: 1,
      collaborators: [],
    });

    const client = new ApiClient("http://localhost", 1000);
    const project = await client.getSplit("proj-2");

    expect(project.projectId).toBe("proj-2");
    expect(project.projectType).toBe("film");
    expect(project.totalDistributed).toBe("200");
  });
});

describe("ApiClient — listProjects query string construction", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.clearAllMocks();
  });

  it("builds correct query string with all params", async () => {
    mockFetchOnce(200, []);
    const client = new ApiClient("http://localhost", 1000);

    await client.listProjects({ start: 10, limit: 5, search: "afro", type: "music" });

    const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string;
    const url = new URL(calledUrl);
    expect(url.searchParams.get("start")).toBe("10");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.get("search")).toBe("afro");
    expect(url.searchParams.get("type")).toBe("music");
  });

  it("omits empty search and type params", async () => {
    mockFetchOnce(200, []);
    const client = new ApiClient("http://localhost", 1000);

    await client.listProjects({ start: 0, limit: 10, search: "", type: "" });

    const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string;
    const url = new URL(calledUrl);
    expect(url.searchParams.has("search")).toBe(false);
    expect(url.searchParams.has("type")).toBe(false);
  });

  it("calls /splits with no query string when no params provided", async () => {
    mockFetchOnce(200, []);
    const client = new ApiClient("http://localhost", 1000);

    await client.listProjects();

    const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(calledUrl).toBe("http://localhost/splits");
  });
});

describe("ApiClient — timeout behaviour", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("throws a timeout error when fetch takes too long", async () => {
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve({ ok: true, json: async () => ({}) } as Response),
            5000,
          ),
        ),
    );

    const client = new ApiClient("http://localhost", 100);
    const promise = client.getAdminStatus();

    // Advance timers past the 100ms timeout
    vi.advanceTimersByTime(200);

    await expect(promise).rejects.toThrow(/timed out/i);
  });
});
