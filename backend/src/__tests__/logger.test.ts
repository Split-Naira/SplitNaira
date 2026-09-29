import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../services/logger.js";

const sensitiveFields = [
  {
    operation: "authentication",
    fields: [
      "password",
      "accessToken",
      "refresh_token",
      "authorization",
      "cookie",
      "api_key",
      "sessionId",
    ],
  },
  {
    operation: "payments",
    fields: [
      "cardNumber",
      "cvv",
      "cvc",
      "security_code",
      "accountNumber",
      "routing_number",
      "iban",
      "paymentToken",
    ],
  },
  {
    operation: "wallet",
    fields: ["walletAddress", "privateKey", "secret_key", "mnemonic", "seed"],
  },
] as const;

describe("Winston logger — structured sensitive-field redaction", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  for (const { operation, fields } of sensitiveFields) {
    describe(`${operation} operations`, () => {
      it.each(fields)("redacts $0 from nested structured metadata", (field) => {
        const sensitiveValue = `sensitive-${operation}-${field}`;
        logger.info(`${operation} operation`, {
          details: [{ [field]: sensitiveValue }],
          outcome: "accepted",
        });

        expect(consoleSpy).toHaveBeenCalledOnce();
        const output = consoleSpy.mock.calls[0][0] as string;
        expect(output).not.toContain(sensitiveValue);
        expect(output).toContain("[REDACTED]");
        expect(output).toContain("accepted");
      });
    });
  }

  it("preserves non-sensitive metadata alongside redacted walletAddress", () => {
    logger.info("Transaction recorded", {
      walletAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      txHash: "abc123",
      amount: "100.00",
    });

    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toContain("txHash");
    expect(output).toContain("abc123");
    expect(output).toContain("amount");
    expect(output).toContain("100.00");
  });

  it("redacts sensitive keys regardless of casing or separators", () => {
    logger.info("User login", {
      Access_Token: "mixed-case-access-token",
      requestId: "test-request",
    });

    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).not.toContain("mixed-case-access-token");
    expect(output).toContain("[REDACTED]");
  });
});
