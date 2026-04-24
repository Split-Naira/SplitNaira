import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../index.js";
import { nativeToScVal } from "@stellar/stellar-sdk";

// hoisted variables for mocks
const { mockGetEvents, mockGetAccount } = vi.hoisted(() => ({
  mockGetEvents: vi.fn(),
  mockGetAccount: vi.fn().mockResolvedValue({})
}));

vi.mock("../services/stellar.js", () => {
  class RequestValidationError extends Error {
    type = "VALIDATION";
    code = "VALIDATION_ERROR";
    constructor(message: string) {
      super(message);
      this.name = "RequestValidationError";
    }
  }
  return {
    loadStellarConfig: () => ({
      horizonUrl: "http://horizon",
      sorobanRpcUrl: "http://rpc",
      networkPassphrase: "test",
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      simulatorAccount: "test_account"
    }),
    getStellarRpcServer: () => ({
      getEvents: mockGetEvents,
      getAccount: mockGetAccount
    }),
    executeWithRetry: async <T>(operation: () => Promise<T>) => operation(),
    RequestValidationError
  };
});

describe("Split History Precise Filtering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should filter history by projectId and event type", async () => {
    const projectId = "project123";
    const topicProjectId = nativeToScVal(projectId, { type: "symbol" }).toXDR("base64");
    const roundTopic = nativeToScVal("distribution_complete", { type: "symbol" }).toXDR("base64");
    const paymentTopic = nativeToScVal("payment_sent", { type: "symbol" }).toXDR("base64");

    mockGetEvents.mockResolvedValue({ events: [] });

    await request(app).get(`/splits/${projectId}/history`);

    // Verify first call (round events)
    expect(mockGetEvents).toHaveBeenCalledWith(expect.objectContaining({
      filters: [{
        type: "contract",
        contractIds: ["CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4"],
        topics: [[roundTopic], [topicProjectId]]
      }]
    }));

    // Verify second call (payment events)
    expect(mockGetEvents).toHaveBeenCalledWith(expect.objectContaining({
      filters: [{
        type: "contract",
        contractIds: ["CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4"],
        topics: [[paymentTopic], [topicProjectId]]
      }]
    }));
  });

  it("should return sorted and formatted events", async () => {
    const projectId = "project123";
    
    mockGetEvents
      .mockResolvedValueOnce({ // Round events
        events: [{
          value: nativeToScVal([1, 1000]),
          txHash: "hash1",
          ledgerClosedAt: "2024-03-29T10:00:00Z",
          id: "1"
        }]
      })
      .mockResolvedValueOnce({ // Payment events
        events: [{
          value: nativeToScVal(["GABC", 500]),
          txHash: "hash2",
          ledgerClosedAt: "2024-03-29T11:00:00Z",
          id: "2"
        }]
      });

    const res = await request(app).get(`/splits/${projectId}/history`);

    if (res.status !== 200) {
      console.error("DEBUG: Response Error Body", JSON.stringify(res.body, null, 2));
    }
    
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].type).toBe("payment"); // Sorted by ledgerCloseTime desc
    expect(res.body.items[1].type).toBe("round");
    expect(res.body.items[0].recipient).toBe("GABC");
    expect(res.body.items[1].round).toBe(1);
    expect(res.body.nextCursor).toBeNull();
  });
});
