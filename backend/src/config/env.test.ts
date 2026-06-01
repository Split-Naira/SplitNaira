import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  validateEnv,
  getEnv,
  getEnvDiagnostics,
  clearEnvCache,
  printEnvDiagnostics
} from "./env.js";
import { logger } from "../services/logger.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VALID_ENV: Record<string, string> = {
  DATABASE_URL: "https://example.com/postgres",
  HORIZON_URL: "https://horizon-testnet.stellar.org",
  SOROBAN_RPC_URL: "https://soroban-testnet.stellar.org",
  SOROBAN_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  CONTRACT_ID: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  SIMULATOR_ACCOUNT: "GABC123SIMULATORACCOUNT456"
};

const REQUIRED_KEYS = Object.keys(VALID_ENV);
let savedEnv: Record<string, string | undefined>;

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  clearEnvCache();
  savedEnv = {};
  for (const key of REQUIRED_KEYS) {
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
  it("returns a typed config when all required vars are present and valid", () => {
    Object.assign(process.env, VALID_ENV);
    const env = validateEnv();

    expect(env.HORIZON_URL).toBe(VALID_ENV.HORIZON_URL);
    expect(env.SOROBAN_RPC_URL).toBe(VALID_ENV.SOROBAN_RPC_URL);
    expect(env.SOROBAN_NETWORK_PASSPHRASE).toBe(VALID_ENV.SOROBAN_NETWORK_PASSPHRASE);
    expect(env.CONTRACT_ID).toBe(VALID_ENV.CONTRACT_ID);
    expect(env.SIMULATOR_ACCOUNT).toBe(VALID_ENV.SIMULATOR_ACCOUNT);
  });

  it("applies the default PORT of '3001' when PORT is not set", () => {
    Object.assign(process.env, VALID_ENV);
    const env = validateEnv();
    expect(env.PORT).toBe("3001");
  });

  it("applies the default NODE_ENV of 'development' when NODE_ENV is not set", () => {
    const saved = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    Object.assign(process.env, VALID_ENV);

    const env = validateEnv();
    expect(env.NODE_ENV).toBe("development");

    if (saved !== undefined) process.env.NODE_ENV = saved;
  });

  it("throws when HORIZON_URL is missing", () => {
    const { HORIZON_URL: _omit, ...rest } = VALID_ENV;
    Object.assign(process.env, rest);

    expect(() => validateEnv()).toThrowError(/HORIZON_URL/);
  });

  it("includes an actionable hint in the HORIZON_URL missing error", () => {
    const { HORIZON_URL: _omit, ...rest } = VALID_ENV;
    Object.assign(process.env, rest);

    expect(() => validateEnv()).toThrowError(/\.env\.example/);
  });

  it("throws when SOROBAN_RPC_URL is missing", () => {
    const { SOROBAN_RPC_URL: _omit, ...rest } = VALID_ENV;
    Object.assign(process.env, rest);

    expect(() => validateEnv()).toThrowError(/SOROBAN_RPC_URL/);
  });

  it("throws when SOROBAN_NETWORK_PASSPHRASE is missing", () => {
    const { SOROBAN_NETWORK_PASSPHRASE: _omit, ...rest } = VALID_ENV;
    Object.assign(process.env, rest);

    expect(() => validateEnv()).toThrowError(/SOROBAN_NETWORK_PASSPHRASE/);
  });

  it("throws when CONTRACT_ID is missing", () => {
    const { CONTRACT_ID: _omit, ...rest } = VALID_ENV;
    Object.assign(process.env, rest);

    expect(() => validateEnv()).toThrowError(/CONTRACT_ID/);
  });

  it("throws when SIMULATOR_ACCOUNT is missing", () => {
    const { SIMULATOR_ACCOUNT: _omit, ...rest } = VALID_ENV;
    Object.assign(process.env, rest);

    expect(() => validateEnv()).toThrowError(/SIMULATOR_ACCOUNT/);
  });

  it("throws when HORIZON_URL is not a valid URL", () => {
    Object.assign(process.env, { ...VALID_ENV, HORIZON_URL: "not-a-url" });

    expect(() => validateEnv()).toThrowError(/HORIZON_URL/);
  });

  it("throws when SOROBAN_RPC_URL is not a valid URL", () => {
    Object.assign(process.env, { ...VALID_ENV, SOROBAN_RPC_URL: "not-a-url" });

    expect(() => validateEnv()).toThrowError(/SOROBAN_RPC_URL/);
  });

  it("lists all missing vars in a single error when multiple are absent", () => {
    // Only set one of the required vars — the rest are missing
    process.env.HORIZON_URL = VALID_ENV.HORIZON_URL;

    expect(() => validateEnv()).toThrowError(/SOROBAN_RPC_URL/);
    expect(() => validateEnv()).toThrowError(/CONTRACT_ID/);
  });

  it("includes the .env.example copy hint in the error message", () => {
    expect(() => validateEnv()).toThrowError(/\.env\.example/);
  });

  it("rejects an empty string for CONTRACT_ID", () => {
    Object.assign(process.env, { ...VALID_ENV, CONTRACT_ID: "" });

    expect(() => validateEnv()).toThrowError(/CONTRACT_ID/);
  });

  it("requires PAYMENTS_ADMIN_API_KEY in production", () => {
    Object.assign(process.env, {
      ...VALID_ENV,
      NODE_ENV: "production",
      CORS_ORIGIN: "https://app.splitnaira.com"
    });
    delete process.env.PAYMENTS_ADMIN_API_KEY;

    expect(() => validateEnv()).toThrowError(/PAYMENTS_ADMIN_API_KEY/);
  });

  it("accepts payments admin controls when configured", () => {
    Object.assign(process.env, {
      ...VALID_ENV,
      NODE_ENV: "production",
      CORS_ORIGIN: "https://app.splitnaira.com",
      PAYMENTS_ADMIN_API_KEY: "super-secret-admin-key",
      PAYMENTS_ADMIN_WRITE_ENABLED: "false"
    });

    const env = validateEnv();
    expect(env.PAYMENTS_ADMIN_API_KEY).toBe("super-secret-admin-key");
    expect(env.PAYMENTS_ADMIN_WRITE_ENABLED).toBe("false");
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
    process.env.HORIZON_URL = "https://horizon.stellar.org";
    const second = getEnv();

    expect(first).not.toBe(second);
    expect(second.HORIZON_URL).toBe("https://horizon.stellar.org");
  });
});

// ─── getEnvDiagnostics() ──────────────────────────────────────────────────────

describe("getEnvDiagnostics()", () => {
  it("returns { ok: true } when all required vars are valid", () => {
    Object.assign(process.env, VALID_ENV);
    expect(getEnvDiagnostics()).toEqual({ ok: true });
  });

  it("returns { ok: false } when required vars are missing", () => {
    const result = getEnvDiagnostics();
    expect(result.ok).toBe(false);
  });

  it("includes the missing key in the issues list", () => {
    const { CONTRACT_ID: _omit, ...rest } = VALID_ENV;
    Object.assign(process.env, rest);

    const result = getEnvDiagnostics();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const keys = result.issues.map((i) => i.key);
      expect(keys).toContain("CONTRACT_ID");
    }
  });

  it("does not throw even when all vars are missing", () => {
    expect(() => getEnvDiagnostics()).not.toThrow();
  });
});

// ─── printEnvDiagnostics() ────────────────────────────────────────────────────

describe("printEnvDiagnostics()", () => {
  it("logs to console without throwing", () => {
    const spy = vi.spyOn(logger, "info").mockImplementation(() => logger);
    Object.assign(process.env, VALID_ENV);

    expect(() => printEnvDiagnostics()).not.toThrow();
    expect(spy).toHaveBeenCalled();

    spy.mockRestore();
  });

  it("marks missing required vars with a MISSING indicator", () => {
    const lines: string[] = [];
    const spy = vi
      .spyOn(logger, "info")
      .mockImplementation((msg: string) => {
        lines.push(msg);
        return logger;
      });

    printEnvDiagnostics();

    const output = lines.join("\n");
    expect(output).toMatch(/MISSING/);

    spy.mockRestore();
  });
});
