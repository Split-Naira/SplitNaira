import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../services/logger.js";

describe("Winston logger — wallet address redaction", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("redacts walletAddress from structured log metadata", () => {
    logger.info("User registered", {
      walletAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      requestId: "test-request"
    });

    expect(consoleSpy).toHaveBeenCalledOnce();
    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).not.toContain("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
    expect(output).toContain("[REDACTED]");
  });

  it("redacts nested walletAddress fields", () => {
    logger.info("Split created", {
      project: {
        owner: {
          walletAddress: "GBIRMAYQUTHQC762ZTJTNXWDSHSDGN64ZXPXJ6XRLWJCAF6TS4Z7J7IO"
        }
      }
    });

    expect(consoleSpy).toHaveBeenCalledOnce();
    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).not.toContain("GBIRMAYQUTHQC762ZTJTNXWDSHSDGN64ZXPXJ6XRLWJCAF6TS4Z7J7IO");
    expect(output).toContain("[REDACTED]");
  });

  it("preserves non-sensitive metadata alongside redacted walletAddress", () => {
    logger.info("Transaction recorded", {
      walletAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      txHash: "abc123",
      amount: "100.00"
    });

    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toContain("txHash");
    expect(output).toContain("abc123");
    expect(output).toContain("amount");
    expect(output).toContain("100.00");
  });

  it("redacts walletAddress regardless of casing in the key", () => {
    logger.info("User login", {
      WalletAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      requestId: "test-request"
    });

    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).not.toContain("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
    expect(output).toContain("[REDACTED]");
  });
});
