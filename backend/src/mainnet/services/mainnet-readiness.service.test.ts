/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';
import { MainnetReadinessService } from './mainnet-readiness.service.js';

// ── Minimal stubs for injected dependencies ──────────────────────────────────

function makeEnvValidator(valid: boolean, missing: string[] = []) {
  return { validate: vi.fn().mockReturnValue({ valid, missing }) };
}

function makeNetworkValidator(valid: boolean) {
  return {
    validate: vi.fn().mockReturnValue({
      valid,
      network: valid ? 'mainnet' : 'testnet',
      horizon: valid ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org',
    }),
  };
}

function makeWalletValidator(valid: boolean) {
  return { validate: vi.fn().mockReturnValue({ valid }) };
}

function makeDataSource(queryOk: boolean) {
  return {
    query: queryOk
      ? vi.fn().mockResolvedValue([{ one: 1 }])
      : vi.fn().mockRejectedValue(new Error('DB connection refused')),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MainnetReadinessService', () => {
  describe('getReadiness — all checks pass', () => {
    it('returns ready=true with all checks passing', async () => {
      const service = new MainnetReadinessService(
        makeDataSource(true) as any,
        makeEnvValidator(true) as any,
        makeNetworkValidator(true) as any,
        makeWalletValidator(true) as any,
      );

      const result = await service.getReadiness();

      expect(result.ready).toBe(true);
      expect(result.checks).toHaveLength(4);
      expect(result.checks.every((c) => c.status === 'pass')).toBe(true);
      expect(result.timestamp).toBeDefined();
    });

    it('includes all four named checks', async () => {
      const service = new MainnetReadinessService(
        makeDataSource(true) as any,
        makeEnvValidator(true) as any,
        makeNetworkValidator(true) as any,
        makeWalletValidator(true) as any,
      );

      const result = await service.getReadiness();
      const names = result.checks.map((c) => c.name);

      expect(names).toContain('environment');
      expect(names).toContain('stellar-network');
      expect(names).toContain('wallet-config');
      expect(names).toContain('database');
    });
  });

  describe('getReadiness — individual check failures', () => {
    it('returns ready=false when environment check fails', async () => {
      const service = new MainnetReadinessService(
        makeDataSource(true) as any,
        makeEnvValidator(false, ['JWT_SECRET', 'REDIS_URL']) as any,
        makeNetworkValidator(true) as any,
        makeWalletValidator(true) as any,
      );

      const result = await service.getReadiness();

      expect(result.ready).toBe(false);
      const envCheck = result.checks.find((c) => c.name === 'environment');
      expect(envCheck?.status).toBe('fail');
    });

    it('returns ready=false when stellar-network check fails', async () => {
      const service = new MainnetReadinessService(
        makeDataSource(true) as any,
        makeEnvValidator(true) as any,
        makeNetworkValidator(false) as any,
        makeWalletValidator(true) as any,
      );

      const result = await service.getReadiness();

      expect(result.ready).toBe(false);
      const networkCheck = result.checks.find((c) => c.name === 'stellar-network');
      expect(networkCheck?.status).toBe('fail');
    });

    it('returns ready=false when wallet-config check fails', async () => {
      const service = new MainnetReadinessService(
        makeDataSource(true) as any,
        makeEnvValidator(true) as any,
        makeNetworkValidator(true) as any,
        makeWalletValidator(false) as any,
      );

      const result = await service.getReadiness();

      expect(result.ready).toBe(false);
      const walletCheck = result.checks.find((c) => c.name === 'wallet-config');
      expect(walletCheck?.status).toBe('fail');
    });

    it('returns ready=false when database check fails', async () => {
      const service = new MainnetReadinessService(
        makeDataSource(false) as any,
        makeEnvValidator(true) as any,
        makeNetworkValidator(true) as any,
        makeWalletValidator(true) as any,
      );

      const result = await service.getReadiness();

      expect(result.ready).toBe(false);
      const dbCheck = result.checks.find((c) => c.name === 'database');
      expect(dbCheck?.status).toBe('fail');
    });
  });

  describe('getReadiness — multiple failures', () => {
    it('returns ready=false and marks all failing checks when multiple checks fail', async () => {
      const service = new MainnetReadinessService(
        makeDataSource(false) as any,
        makeEnvValidator(false, ['JWT_SECRET']) as any,
        makeNetworkValidator(false) as any,
        makeWalletValidator(false) as any,
      );

      const result = await service.getReadiness();

      expect(result.ready).toBe(false);
      const failingChecks = result.checks.filter((c) => c.status === 'fail');
      expect(failingChecks.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('getReadiness — response shape', () => {
    it('timestamp is a valid ISO 8601 string', async () => {
      const service = new MainnetReadinessService(
        makeDataSource(true) as any,
        makeEnvValidator(true) as any,
        makeNetworkValidator(true) as any,
        makeWalletValidator(true) as any,
      );

      const result = await service.getReadiness();

      expect(() => new Date(result.timestamp)).not.toThrow();
      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    });
  });
});
