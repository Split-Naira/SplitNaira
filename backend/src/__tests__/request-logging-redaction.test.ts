// #946 — Active Express request logging must never emit cookie or
// Authorization header contents in stdout/morgan output.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app, scrubWalletAddresses } from "../index.js";

describe("Express request logging redaction (#946)", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  const chunks: string[] = [];

  beforeEach(() => {
    chunks.length = 0;
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      return true;
    });
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it("does not log cookie or Authorization header values", async () => {
    await request(app)
      .get("/unknown-route")
      .set("Cookie", "session=super-secret-cookie")
      .set("Authorization", "Bearer super-secret-jwt");

    const rawLogOutput = chunks.join("");

    expect(rawLogOutput).not.toContain("super-secret-cookie");
    expect(rawLogOutput).not.toContain("session=");
    expect(rawLogOutput).not.toContain("super-secret-jwt");
    expect(rawLogOutput).not.toContain("Bearer ");
  });

  it("redacts Stellar wallet addresses from logged URLs", () => {
    const wallet = "GBBD47UZQ434KEPNRQV4EOZSQHUFEYKLMQS5BQPKHERUCBLEUFPYT75D";

    expect(scrubWalletAddresses(`/transactions/recipient/${wallet}`)).toBe(
      "/transactions/recipient/[WALLET_REDACTED]"
    );
  });
});
