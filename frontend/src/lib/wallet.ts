"use client";

import {
  getAddress,
  getNetwork,
  requestAccess,
  signTransaction,
} from "@stellar/freighter-api";

export { createSorobanRpcServer, submitSorobanTransactionAndPoll } from "./soroban-transaction";

export interface WalletState {
  connected: boolean;
  address: string | null;
  network: string | null;
}

type FreighterResult = {
  error?: { message?: string };
};

function throwIfFreighterError(result: FreighterResult): void {
  if (result.error) {
    throw new Error(result.error.message ?? "Freighter returned an error.");
  }
}

function parseNetwork(network: string): string {
  const n = network.toLowerCase();
  if (n.includes("test")) return "TESTNET";
  if (n.includes("future")) return "FUTURENET";
  if (n.includes("public") || n.includes("main")) return "PUBLIC";
  if (n.includes("sandbox")) return "SANDBOX";
  if (n.includes("standalone")) return "STANDALONE";
  return network;
}

async function readNetwork(fallback: string | null = null): Promise<string | null> {
  try {
    const result = await getNetwork();
    throwIfFreighterError(result);
    return result.network ? parseNetwork(result.network) : fallback;
  } catch {
    return fallback;
  }
}

export async function getWalletState(): Promise<WalletState> {
  try {
    const result = await getAddress();
    throwIfFreighterError(result);

    if (!result.address) {
      return { connected: false, address: null, network: null };
    }

    return {
      connected: true,
      address: result.address,
      network: await readNetwork(),
    };
  } catch {
    return { connected: false, address: null, network: null };
  }
}

export async function connectWallet(network?: string): Promise<WalletState> {
  const targetNetwork = network ?? "TESTNET";
  const result = await requestAccess();
  throwIfFreighterError(result);

  if (!result.address) {
    throw new Error("Freighter did not return a wallet address.");
  }

  return {
    connected: true,
    address: result.address,
    network: await readNetwork(targetNetwork),
  };
}

export async function signWithWallet(xdr: string, networkPassphrase: string): Promise<string> {
  const result = await signTransaction(xdr, { networkPassphrase });
  throwIfFreighterError(result);

  if (!result.signedTxXdr) {
    throw new Error("Wallet did not return a signed transaction.");
  }

  return result.signedTxXdr;
}
