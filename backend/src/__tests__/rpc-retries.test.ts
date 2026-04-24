import { describe, it, expect, vi } from "vitest";
import { executeWithRetry, RpcTimeoutError, RpcError, RequestValidationError } from "../services/stellar.js";

describe("RPC Retry and Timeout Policy", () => {
  describe("executeWithRetry Utility", () => {
    it("should return result immediately on success", async () => {
      const operation = vi.fn().mockResolvedValue("success");
      const result = await executeWithRetry(operation);
      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it("should retry transient failures and eventually succeed", async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error("Transient error"))
        .mockRejectedValueOnce(new Error("Transient error"))
        .mockResolvedValue("success");

      const result = await executeWithRetry(operation, { initialDelayMs: 1 });
      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it("should throw RpcTimeoutError when operation exceeds timeout", async () => {
      // Use a long-running promise to simulate a timeout
      const operation = () => new Promise((resolve) => {
        setTimeout(() => resolve("late"), 200);
      });
      
      await expect(executeWithRetry(operation, { timeoutMs: 50 })).rejects.toThrow(RpcTimeoutError);
    });

    it("should exhaust retries and throw the last error", async () => {
      const operation = vi.fn().mockRejectedValue(new Error("Persistent error"));
      
      await expect(executeWithRetry(operation, { 
        maxRetries: 2, 
        initialDelayMs: 1 
      })).rejects.toThrow("Persistent error");
      
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it("should NOT retry RequestValidationError", async () => {
      const operation = vi.fn().mockRejectedValue(new RequestValidationError("Invalid input"));
      
      await expect(executeWithRetry(operation, { 
        maxRetries: 3, 
        initialDelayMs: 1 
      })).rejects.toThrow(RequestValidationError);
      
      expect(operation).toHaveBeenCalledTimes(1);
    });
  });

  describe("RPC Error Classes", () => {
    it("RpcError should have default status code 502", () => {
      const error = new RpcError("Failed");
      expect(error.statusCode).toBe(502);
      expect(error.name).toBe("RpcError");
    });

    it("RpcTimeoutError should have status code 504", () => {
      const error = new RpcTimeoutError();
      expect(error.statusCode).toBe(504);
      expect(error.name).toBe("RpcTimeoutError");
    });
  });
});
