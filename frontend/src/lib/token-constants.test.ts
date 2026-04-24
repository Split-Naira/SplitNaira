import { describe, expect, it } from "vitest";

import { KNOWN_TOKENS, getTokensByNetwork } from "./token-constants";

describe("token constants", () => {
  it("does not expose unsupported native token options", () => {
    expect(KNOWN_TOKENS.some((token) => token.id === "native")).toBe(false);
  });

  it("only returns contract-address tokens for each network", () => {
    for (const network of ["testnet", "mainnet"] as const) {
      const networkTokens = getTokensByNetwork(network);
      expect(networkTokens.length).toBeGreaterThan(0);
      for (const token of networkTokens) {
        expect(token.id.startsWith("C")).toBe(true);
      }
    }
  });
});
