// Known token contracts by network
export interface TokenInfo {
  id: string; // Contract ID or "native" for XLM
  name: string;
  network: "testnet" | "mainnet";
  code?: string; // Asset code (e.g., "USDC", "XLM")
}

export const KNOWN_TOKENS: TokenInfo[] = [
  // Testnet tokens
  {
    id: "native",
    name: "Stellar Lumens (XLM)",
    network: "testnet",
    code: "XLM"
  },
  {
    id: "CBLASIRZ7CUKC7S5IS3VSNMQGKZ5FTRWLHZZXH7H4YG6ZLRFPJF5H2LR",
    name: "USD Coin (USDC)",
    network: "testnet",
    code: "USDC"
  },
  {
    id: "CDLZJQG2OZZXZAU3YICESOJE73SOXREH74DRBEDAFTMPциклон",
    name: "Soroban Waved USD (wUSD)",
    network: "testnet",
    code: "wUSD"
  },

  // Mainnet tokens
  {
    id: "native",
    name: "Stellar Lumens (XLM)",
    network: "mainnet",
    code: "XLM"
  },
  {
    id: "CBBD3L2DQADRDX3CI4UJL3XNPVVVMMB7VPZL3DQUMHWQ6XGYWYSGPBEM",
    name: "USD Coin (USDC)",
    network: "mainnet",
    code: "USDC"
  },
  {
    id: "CAQLY5C7KDNHBX64CTMZ7JVYQSXC3MSWQJ5XLPZ7KUG2LSX2DTG3GXM",
    name: "Brazilian Real (BRLUSD)",
    network: "mainnet",
    code: "BRLUSD"
  }
];

/**
 * Get tokens for a specific network
 */
export function getTokensByNetwork(network: string | null): TokenInfo[] {
  if (!network) return [];
  
  const normalizedNetwork = network.toLowerCase() as "testnet" | "mainnet";
  return KNOWN_TOKENS.filter((token) => token.network === normalizedNetwork);
}

/**
 * Find a token by ID
 */
export function getTokenById(id: string): TokenInfo | undefined {
  return KNOWN_TOKENS.find((token) => token.id === id);
}

/**
 * Get display name for a token
 */
export function getTokenDisplayName(id: string): string {
  const token = getTokenById(id);
  return token ? `${token.name} (${token.code || id.slice(0, 6)}...)` : id;
}
