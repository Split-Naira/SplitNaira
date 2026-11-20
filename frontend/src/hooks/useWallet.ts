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
  const generationRef = useRef(0);
  const refreshPromiseRef = useRef<{
    generation: number;
    promise: Promise<boolean>;
  } | null>(null);
  const connectPromiseRef = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (connectPromiseRef.current) return connectPromiseRef.current;

    const generation = generationRef.current;
    const activeRefresh = refreshPromiseRef.current;
    if (activeRefresh?.generation === generation) return activeRefresh.promise;

    dispatch({ type: "LOADING" });
    const promise = (async () => {
      try {
        const walletState = await getWalletState();
        if (mountedRef.current && generation === generationRef.current) {
          dispatch({ type: "SUCCESS", payload: walletState });
          return true;
        }
        return false;
      } catch (err) {
        if (err instanceof Error) {
          Sentry.captureException(err, {
            tags: {
              section: "wallet-hook",
              action: "refresh",
            },
          });
        }
        if (mountedRef.current && generation === generationRef.current) {
          dispatch({
            type: "ERROR",
            payload: err instanceof Error ? err.message : "Unknown error",
          });
        }
        return false;
      }
    })();

    refreshPromiseRef.current = { generation, promise };
    void promise.then(() => {
      if (refreshPromiseRef.current?.promise === promise) {
        refreshPromiseRef.current = null;
      }
    });
    return promise;
  }, []);

  const connect = useCallback(async () => {
    if (connectPromiseRef.current) return connectPromiseRef.current;

    const generation = ++generationRef.current;
    dispatch({ type: "LOADING" });
    const promise = (async () => {
      try {
        const walletState = await connectWallet();
        if (mountedRef.current && generation === generationRef.current) {
          dispatch({ type: "SUCCESS", payload: walletState });
          return true;
        }
        return false;
      } catch (err) {
        if (err instanceof Error) {
          Sentry.captureException(err, {
            tags: {
              section: "wallet-hook",
              action: "connect",
            },
          });
        }
        if (mountedRef.current && generation === generationRef.current) {
          dispatch({
            type: "ERROR",
            payload: err instanceof Error ? err.message : "Failed to connect",
          });
        }
        return false;
      }
    })();

    connectPromiseRef.current = promise;
    void promise.then(() => {
      if (connectPromiseRef.current === promise) {
        connectPromiseRef.current = null;
      }
    });
    return promise;
  }, []);

  const reset = useCallback(() => {
    generationRef.current += 1;
    dispatch({ type: "RESET" });
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
      reset();
      refresh();
    }

    prevAddressRef.current = current;
  }, [state.wallet.address, refresh, reset]);

  // Poll for wallet account changes every 2s while connected.
  // Freighter does not emit events, so we poll getWalletState().
  useEffect(() => {
    if (!state.wallet.connected || !state.wallet.address) return;

    const interval = setInterval(async () => {
      const generation = generationRef.current;
      try {
        const fresh = await getWalletState();
        if (generation !== generationRef.current) return;
        // Issue #1507: a disconnect has to clear state too. The previous
        // guard required `fresh.connected`, which made the one transition that
        // most needs clearing — the user disconnecting — the one that was
        // dropped. State kept `connected: true` and the old address, so stale
        // balances stayed on screen, old-account actions remained reachable,
        // and the "reconnect" toast could never fire because it keys off the
        // same flag that was never updated.
        if (!fresh.connected || fresh.address !== state.wallet.address) {
          reset();
          refresh();
        }
      } catch {
        // Ignore poll errors — wallet extension may be temporarily unavailable.
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [state.wallet.connected, state.wallet.address, refresh, reset]);

  return { ...state, connect, refresh };
}
