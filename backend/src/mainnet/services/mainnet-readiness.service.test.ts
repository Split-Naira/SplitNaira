import { describe, expect, it, vi } from 'vitest';

import { MainnetReadinessService } from './mainnet-readiness.service.js';

type EnvValidator = {
  validate: ReturnType<typeof vi.fn>;
};

type NetworkValidator = {
  validate: ReturnType<typeof vi.fn>;
};

type WalletValidator = {
  validate: ReturnType<typeof vi.fn>;
};

type DataSource = {
  query: ReturnType<typeof vi.fn>;
};

function createEnvValidator(
  valid = true,
  missing: string[] = [],
): EnvValidator {
  return {
    validate: vi.fn().mockReturnValue({
      valid,
      missing,
    }),
  };
}

function createNetworkValidator(valid = true): NetworkValidator {
  return {
    validate: vi.fn().mockReturnValue({
      valid,
      network: valid ? 'mainnet' : 'testnet',
      horizon: valid
        ? 'https://horizon.stellar.org'
        : 'https://horizon-testnet.stellar.org',
    }),
  };
}

function createWalletValidator(valid = true): WalletValidator {
  return {
    validate: vi.fn().mockReturnValue({
      valid,
    }),
  };
}

function createDataSource(healthy = true): DataSource {
  return {
    query: healthy
      ? vi.fn().mockResolvedValue([{ one: 1 }])
      : vi.fn().mockRejectedValue(
          new Error('DB connection refused'),
        ),
  };
}

function createService({
  database = true,
  environment = true,
  network = true,
  wallet = true,
  missingEnv = [],
}: {
  database?: boolean;
  environment?: boolean;
  network?: boolean;
  wallet?: boolean;
  missingEnv?: string[];
} = {}) {
  return new MainnetReadinessService(
    createDataSource(database),
    createEnvValidator(environment, missingEnv),
    createNetworkValidator(network),
    createWalletValidator(wallet),
  );
}

describe('MainnetReadinessService', () => {
  describe('getReadiness', () => {
    it('returns ready when all checks pass', async () => {
      const service = createService();

      const result = await service.getReadiness();

      expect(result.ready).toBe(true);
      expect(result.checks).toHaveLength(4);
      expect(result.checks.every((check) => check.status === 'pass')).toBe(
        true,
      );
    });

    it('includes all expected readiness checks', async () => {
      const service = createService();

      const result = await service.getReadiness();

      expect(result.checks.map((check) => check.name)).toEqual(
        expect.arrayContaining([
          'environment',
          'stellar-network',
          'wallet-config',
          'database',
        ]),
      );
    });

    it('returns not ready when environment validation fails', async () => {
      const service = createService({
        environment: false,
        missingEnv: ['JWT_SECRET', 'REDIS_URL'],
      });

      const result = await service.getReadiness();

      expect(result.ready).toBe(false);

      const environmentCheck = result.checks.find(
        (check) => check.name === 'environment',
      );

      expect(environmentCheck?.status).toBe('fail');
    });

    it('returns not ready when Stellar network validation fails', async () => {
      const service = createService({
        network: false,
      });

      const result = await service.getReadiness();

      expect(result.ready).toBe(false);

      const networkCheck = result.checks.find(
        (check) => check.name === 'stellar-network',
      );

      expect(networkCheck?.status).toBe('fail');
    });

    it('returns not ready when wallet configuration is invalid', async () => {
      const service = createService({
        wallet: false,
      });

      const result = await service.getReadiness();

      expect(result.ready).toBe(false);

      const walletCheck = result.checks.find(
        (check) => check.name === 'wallet-config',
      );

      expect(walletCheck?.status).toBe('fail');
    });

    it('returns not ready when the database is unavailable', async () => {
      const service = createService({
        database: false,
      });

      const result = await service.getReadiness();

      expect(result.ready).toBe(false);

      const databaseCheck = result.checks.find(
        (check) => check.name === 'database',
      );

      expect(databaseCheck?.status).toBe('fail');
    });

    it('reports all failed checks when every dependency is unhealthy', async () => {
      const service = createService({
        database: false,
        environment: false,
        network: false,
        wallet: false,
        missingEnv: ['JWT_SECRET'],
      });

      const result = await service.getReadiness();

      expect(result.ready).toBe(false);

      const failedChecks = result.checks.filter(
        (check) => check.status === 'fail',
      );

      expect(failedChecks).toHaveLength(4);
    });
  });

  describe('response metadata', () => {
    it('returns a valid ISO 8601 timestamp', async () => {
      const service = createService();

      const result = await service.getReadiness();

      expect(result.timestamp).toBeDefined();
      expect(new Date(result.timestamp).toISOString()).toBe(
        result.timestamp,
      );
    });
  });

  describe('dependency interactions', () => {
    it('runs the database health query', async () => {
      const database = createDataSource(true);

      const service = new MainnetReadinessService(
        database as any,
        createEnvValidator(),
        createNetworkValidator(),
        createWalletValidator(),
      );

      await service.getReadiness();

      expect(database.query).toHaveBeenCalledTimes(1);
    });

    it('runs environment validation', async () => {
      const environment = createEnvValidator();

      const service = new MainnetReadinessService(
        createDataSource(),
        environment as any,
        createNetworkValidator(),
        createWalletValidator(),
      );

      await service.getReadiness();

      expect(environment.validate).toHaveBeenCalledTimes(1);
    });

    it('runs Stellar network validation', async () => {
      const network = createNetworkValidator();

      const service = new MainnetReadinessService(
        createDataSource(),
        createEnvValidator(),
        network as any,
        createWalletValidator(),
      );

      await service.getReadiness();

      expect(network.validate).toHaveBeenCalledTimes(1);
    });

    it('runs wallet validation', async () => {
      const wallet = createWalletValidator();

      const service = new MainnetReadinessService(
        createDataSource(),
        createEnvValidator(),
        createNetworkValidator(),
        wallet as any,
      );

      await service.getReadiness();

      expect(wallet.validate).toHaveBeenCalledTimes(1);
    });
  });
});