"use client";

import {
  getAddress,
  getNetworkDetails,
  isAllowed,
  requestAccess,
  signTransaction
} from "@stellar/freighter-api";

export interface WalletState {
  connected: boolean;
  address: string | null;
  network: string | null;
}

export async function getFreighterWalletState(): Promise<WalletState> {
  const allowed = await isAllowed();
  if (!allowed.isAllowed) {
    return { connected: false, address: null, network: null };
  }

  const [addressResult, networkResult] = await Promise.all([getAddress(), getNetworkDetails()]);

  if (addressResult.error) {
    throw new Error(addressResult.error);
  }

  if (networkResult.error) {
    throw new Error(networkResult.error);
  }

  return {
    connected: true,
    address: addressResult.address ?? null,
    network: networkResult.network ?? null
  };
}

export async function connectFreighter(): Promise<WalletState> {
  const access = await requestAccess();
  if (access.error) {
    throw new Error(access.error);
  }
  return getFreighterWalletState();
}

export async function signWithFreighter(xdr: string, networkPassphrase: string): Promise<string> {
  const signed = await signTransaction(xdr, {
    networkPassphrase
  });

  if (signed.error) {
    throw new Error(signed.error);
  }

  if (!signed.signedTxXdr) {
    throw new Error("Freighter did not return a signed transaction.");
  }

  return signed.signedTxXdr;
}
