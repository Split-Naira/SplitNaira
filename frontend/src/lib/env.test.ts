import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { validateEnv, getEnv, clearEnvCache } from "./env";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VALID_ENV: Record<string, string> = {
  NEXT_PUBLIC_STELLAR_NETWORK: "testnet",
  NEXT_PUBLIC_SOROBAN_RPC_URL: "https://soroban-testnet.stellar.org",
  NEXT_PUBLIC_HORIZON_URL: "https://horizon-testnet.stellar.org",
  NEXT_PUBLIC_API_BASE_URL: "http://localhost:3001",
  NEXT_PUBLIC_CONTRACT_ID: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
};

const ENV_KEYS = Object.keys(VALID_ENV);
let savedEnv: Record<string, string | undefined>;

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  clearEnvCache();
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  clearEnvCache();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

// ─── validateEnv() ────────────────────────────────────────────────────────────

describe("validateEnv()", () => {
  it("returns a typed config when all vars are present and valid", () => {
    Object.assign(process.env, VALID_ENV);
    const env = validateEnv();

    expect(env.NEXT_PUBLIC_STELLAR_NETWORK).toBe("testnet");
    expect(env.NEXT_PUBLIC_API_BASE_URL).toBe("http://localhost:3001");
    expect(env.NEXT_PUBLIC_HORIZON_URL).toBe("https://horizon-testnet.stellar.org");
  });

  it("accepts 'mainnet' as a valid STELLAR_NETWORK value", () => {
    Object.assign(process.env, { ...VALID_ENV, NEXT_PUBLIC_STELLAR_NETWORK: "mainnet" });
    const env = validateEnv();
    expect(env.NEXT_PUBLIC_STELLAR_NETWORK).toBe("mainnet");
  });

  it("falls back to 'testnet' when NEXT_PUBLIC_STELLAR_NETWORK is not set", () => {
    const { NEXT_PUBLIC_STELLAR_NETWORK: _omit, ...rest } = VALID_ENV;
    Object.assign(process.env, rest);
    const env = validateEnv();
    expect(env.NEXT_PUBLIC_STELLAR_NETWORK).toBe("testnet");
  });

  it("accepts legacy NEXT_PUBLIC_NETWORK as an alias for NEXT_PUBLIC_STELLAR_NETWORK", () => {
    Object.assign(process.env, {
      ...VALID_ENV,
      NEXT_PUBLIC_STELLAR_NETWORK: undefined as unknown as string,
      NEXT_PUBLIC_NETWORK: "mainnet",
    });
    const env = validateEnv();
    expect(env.NEXT_PUBLIC_STELLAR_NETWORK).toBe("mainnet");
  });

  it("throws when NEXT_PUBLIC_NETWORK and NEXT_PUBLIC_STELLAR_NETWORK conflict", () => {
    Object.assign(process.env, {
      ...VALID_ENV,
      NEXT_PUBLIC_STELLAR_NETWORK: "testnet",
      NEXT_PUBLIC_NETWORK: "mainnet",
    });
    expect(() => validateEnv()).toThrowError(/Conflicting network configuration/);
  });

  it("falls back to the testnet Soroban RPC URL when not set", () => {
    const { NEXT_PUBLIC_SOROBAN_RPC_URL: _omit, ...rest } = VALID_ENV;
    Object.assign(process.env, rest);
    const env = validateEnv();
    expect(env.NEXT_PUBLIC_SOROBAN_RPC_URL).toBe("https://soroban-testnet.stellar.org");
  });

  it("falls back to 'http://localhost:3001' for API_BASE_URL when not set", () => {
    const { NEXT_PUBLIC_API_BASE_URL: _omit, ...rest } = VALID_ENV;
    Object.assign(process.env, rest);
    const env = validateEnv();
    expect(env.NEXT_PUBLIC_API_BASE_URL).toBe("http://localhost:3001");
  });

  it("throws when NEXT_PUBLIC_STELLAR_NETWORK has an unrecognised value", () => {
    Object.assign(process.env, {
      ...VALID_ENV,
      NEXT_PUBLIC_STELLAR_NETWORK: "futurenet"
    });
    expect(() => validateEnv()).toThrowError(/NEXT_PUBLIC_STELLAR_NETWORK/);
  });

  it("throws when NEXT_PUBLIC_SOROBAN_RPC_URL is not a valid URL", () => {
    Object.assign(process.env, {
      ...VALID_ENV,
      NEXT_PUBLIC_SOROBAN_RPC_URL: "not-a-url"
    });
    expect(() => validateEnv()).toThrowError(/NEXT_PUBLIC_SOROBAN_RPC_URL/);
  });

  it("throws when NEXT_PUBLIC_HORIZON_URL is not a valid URL", () => {
    Object.assign(process.env, {
      ...VALID_ENV,
      NEXT_PUBLIC_HORIZON_URL: "ftp://bad-scheme"
    });
    expect(() => validateEnv()).toThrowError(/NEXT_PUBLIC_HORIZON_URL/);
  });

  it("throws when NEXT_PUBLIC_API_BASE_URL is not a valid URL", () => {
    Object.assign(process.env, {
      ...VALID_ENV,
      NEXT_PUBLIC_API_BASE_URL: "localhost-no-scheme"
    });
    expect(() => validateEnv()).toThrowError(/NEXT_PUBLIC_API_BASE_URL/);
  });

  it("includes the .env.example copy hint in the error message", () => {
    Object.assign(process.env, {
      ...VALID_ENV,
      NEXT_PUBLIC_API_BASE_URL: "bad-value"
    });
    expect(() => validateEnv()).toThrowError(/\.env\.example/);
  });

  it("emits a console.warn when CONTRACT_ID is absent", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { NEXT_PUBLIC_CONTRACT_ID: _omit, ...rest } = VALID_ENV;
    Object.assign(process.env, rest);

    validateEnv();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("NEXT_PUBLIC_CONTRACT_ID"));
    warnSpy.mockRestore();
  });

  it("throws when CONTRACT_ID is absent during a production build", async () => {
    vi.resetModules();
    const savedNodeEnv = process.env.NODE_ENV;
    const savedNextPhase = process.env.NEXT_PHASE;
    const { NEXT_PUBLIC_CONTRACT_ID: _omit, ...rest } = VALID_ENV;
    Object.assign(process.env, rest, { NODE_ENV: "production", NEXT_PHASE: "phase-production-build" });
    delete process.env.NEXT_PUBLIC_CONTRACT_ID;

    try {
      const mod = await import("./env");
      expect(() => mod.validateEnv()).toThrowError(/NEXT_PUBLIC_CONTRACT_ID/);
    } finally {
      vi.resetModules();
      if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = savedNodeEnv;
      if (savedNextPhase === undefined) delete process.env.NEXT_PHASE;
      else process.env.NEXT_PHASE = savedNextPhase;
    }
  });

  it("does not warn when CONTRACT_ID is provided", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    Object.assign(process.env, VALID_ENV);

    validateEnv();

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// ─── getEnv() ─────────────────────────────────────────────────────────────────

describe("getEnv()", () => {
  it("caches and returns the same object on subsequent calls", () => {
    Object.assign(process.env, VALID_ENV);
    const first = getEnv();
    const second = getEnv();

    expect(first).toBe(second);
  });

  it("re-validates after clearEnvCache()", () => {
    Object.assign(process.env, VALID_ENV);
    const first = getEnv();

    clearEnvCache();
    process.env.NEXT_PUBLIC_API_BASE_URL = "http://localhost:9999";
    const second = getEnv();

    expect(first).not.toBe(second);
    expect(second.NEXT_PUBLIC_API_BASE_URL).toBe("http://localhost:9999");
  });
});
