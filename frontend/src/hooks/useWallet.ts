"use client";

import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useCallback,
  useRef,
} from "react";
import * as Sentry from "@sentry/nextjs";
import {
  getWalletState,
  connectWallet,
  type WalletState,
} from "../lib/wallet";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WalletContextValue {
  wallet: WalletState;
  loading: boolean;
  error: string | null;
  connect: () => Promise<boolean>;
  refresh: () => Promise<boolean>;
}

// ─── State machine ────────────────────────────────────────────────────────────

type Action =
  | { type: "LOADING" }
  | { type: "SUCCESS"; payload: WalletState }
  | { type: "ERROR"; payload: string }
  | { type: "RESET" };

interface State {
  wallet: WalletState;
  loading: boolean;
  error: string | null;
}

const initialState: State = {
  wallet: { connected: false, address: null, network: null },
  loading: false,
  error: null,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "LOADING":
      return { ...state, loading: true, error: null };
    case "SUCCESS":
      return { wallet: action.payload, loading: false, error: null };
    case "ERROR":
      return { ...state, loading: false, error: action.payload };
    case "RESET":
      return initialState;
    default:
      return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

export const WalletContext = createContext<WalletContextValue | null>(null);

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error("useWallet must be used inside <WalletProvider>");
  }
  return ctx;
}

// ─── Internal hook used by WalletProvider ─────────────────────────────────────

export function useWalletState() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    dispatch({ type: "LOADING" });
    try {
      const walletState = await getWalletState();
      if (mountedRef.current)
        dispatch({ type: "SUCCESS", payload: walletState });
      return true;
    } catch (err) {
      if (err instanceof Error) {
        Sentry.captureException(err, {
          tags: {
            section: "wallet-hook",
            action: "refresh",
          }
        });
      }
      if (mountedRef.current)
        dispatch({
          type: "ERROR",
          payload: err instanceof Error ? err.message : "Unknown error",
        });
      return false;
    }
  }, []);

  const connect = useCallback(async () => {
    dispatch({ type: "LOADING" });
    try {
      const walletState = await connectWallet();
      if (mountedRef.current)
        dispatch({ type: "SUCCESS", payload: walletState });
      return true;
    } catch (err) {
      if (err instanceof Error) {
        Sentry.captureException(err, {
          tags: {
            section: "wallet-hook",
            action: "connect",
          }
        });
      }
      if (mountedRef.current)
        dispatch({
          type: "ERROR",
          payload: err instanceof Error ? err.message : "Failed to connect",
        });
      return false;
    }
  }, []);

  // Auto-restore session on mount
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Detect wallet account switch — when StellarWalletsKit address changes
  // while we already had a connected wallet, reset state and reload.
  const prevAddressRef = useRef(state.wallet.address);
  useEffect(() => {
    const prev = prevAddressRef.current;
    const current = state.wallet.address;

    if (prev && current && prev !== current) {
      dispatch({ type: "RESET" });
      refresh();
    }

    prevAddressRef.current = current;
  }, [state.wallet.address, refresh]);

  // Poll for wallet account changes every 2s while connected.
  // Freighter does not emit events, so we poll getWalletState().
  useEffect(() => {
    if (!state.wallet.connected || !state.wallet.address) return;

    const interval = setInterval(async () => {
      try {
        const fresh = await getWalletState();
        if (
          fresh.connected &&
          fresh.address !== state.wallet.address
        ) {
          dispatch({ type: "RESET" });
          refresh();
        }
      } catch {
        // Ignore poll errors — wallet extension may be temporarily unavailable.
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [state.wallet.connected, state.wallet.address, refresh]);

  return { ...state, connect, refresh };
}
