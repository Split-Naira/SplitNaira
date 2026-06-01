import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { ApiClient } from "../lib/api-client";
import { submitSorobanTransactionAndPoll } from "../lib/soroban-transaction";
import { rpc } from "@stellar/stellar-sdk";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  init: vi.fn(),
}));

vi.mock("@stellar/stellar-sdk", () => {
  return {
    rpc: {
      Server: vi.fn().mockImplementation(() => ({
        sendTransaction: vi.fn(),
        pollTransaction: vi.fn(),
      })),
    },
    Transaction: vi.fn(),
  };
});

describe("Frontend Observability - Sentry & Retry Integrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("ApiClient retries on failure and logs to Sentry on final exhaustion", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockRejectedValue(new Error("Network failure"));

    const client = new ApiClient("http://localhost", 100);

    await expect(client.getAdminTokenCount()).rejects.toThrow("Network failure");

    // It should try 3 times because of the withRetry decorator/logic
    expect(mockFetch).toHaveBeenCalledTimes(3);

    // It should capture the exception in Sentry exactly once on final failure
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({
          section: "api-client",
          path: "/splits/admin/token-count",
        }),
      })
    );
  });

  it("ApiClient succeeds if a retry attempt succeeds before exhaustion", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockRejectedValueOnce(new Error("Timeout 1"))
      .mockRejectedValueOnce(new Error("Timeout 2"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ count: 5 }),
      } as Response);

    const client = new ApiClient("http://localhost", 100);
    const result = await client.getAdminTokenCount();

    expect(result).toEqual({ count: 5 });
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("submitSorobanTransactionAndPoll captures Sentry exception on submission error", async () => {
    const mockServer = {
      sendTransaction: vi.fn().mockResolvedValue({
        status: "ERROR",
        errorResult: "tx_bad_seq",
      }),
      pollTransaction: vi.fn(),
    } as unknown as rpc.Server;

    const mockTx = {} as any;

    await expect(
      submitSorobanTransactionAndPoll(mockServer, mockTx)
    ).rejects.toThrow("tx_bad_seq");

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: {
          section: "soroban-transaction",
          action: "submit",
          status: "ERROR",
        },
      })
    );
  });

  it("submitSorobanTransactionAndPoll captures Sentry exception on polling failure", async () => {
    const mockServer = {
      sendTransaction: vi.fn().mockResolvedValue({
        status: "PENDING",
        hash: "test_tx_hash",
      }),
      pollTransaction: vi.fn().mockResolvedValue({
        status: "FAILED",
        resultXdr: "AAAAAA...",
      }),
    } as unknown as rpc.Server;

    const mockTx = {} as any;

    await expect(
      submitSorobanTransactionAndPoll(mockServer, mockTx)
    ).rejects.toThrow("AAAAAA...");

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: {
          section: "soroban-transaction",
          action: "poll",
          status: "FAILED",
        },
        extra: expect.objectContaining({
          txHash: "test_tx_hash",
        }),
      })
    );
  });
});
