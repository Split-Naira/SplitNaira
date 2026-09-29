import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';

import { HealthService } from './health.service';

describe('HealthService', () => {
  let service: HealthService;

  const dataSourceMock = {
    query: jest.fn(),
  };

  const redisMock = {
    ping: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: DataSource,
          useValue: dataSourceMock,
        },
        {
          provide: Redis,
          useValue: redisMock,
        },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
  });

  describe('getLiveness', () => {
    it('returns an alive status', () => {
      expect(service.getLiveness()).toEqual({
        status: 'alive',
      });
    });

    it('does not check external dependencies', () => {
      service.getLiveness();

      expect(dataSourceMock.query).not.toHaveBeenCalled();
      expect(redisMock.ping).not.toHaveBeenCalled();
    });
  });

  describe('getReadiness', () => {
    beforeEach(() => {
      dataSourceMock.query.mockResolvedValue([]);
      redisMock.ping.mockResolvedValue('PONG');
    });

    it('returns ready when all dependencies are healthy', async () => {
      const result = await service.getReadiness();

      expect(result.status).toBe('ready');
      expect(dataSourceMock.query).toHaveBeenCalled();
      expect(redisMock.ping).toHaveBeenCalled();
    });

    it('returns not ready when the database is unavailable', async () => {
      dataSourceMock.query.mockRejectedValue(
        new Error('connection refused'),
      );

      const result = await service.getReadiness();

      expect(result.status).toBe('not ready');
      expect(result.details?.database?.status).toBe('down');
      expect(result.details?.redis?.status).toBe('up');
    });

    it('returns not ready when Redis is unavailable', async () => {
      redisMock.ping.mockRejectedValue(
        new Error('ECONNREFUSED'),
      );

      const result = await service.getReadiness();

      expect(result.status).toBe('not ready');
      expect(result.details?.database?.status).toBe('up');
      expect(result.details?.redis?.status).toBe('down');
    });

    it('reports both dependencies as down when both checks fail', async () => {
      dataSourceMock.query.mockRejectedValue(
        new Error('database unavailable'),
      );

      redisMock.ping.mockRejectedValue(
        new Error('redis unavailable'),
      );

      const result = await service.getReadiness();

      expect(result.status).toBe('not ready');
      expect(result.details?.database?.status).toBe('down');
      expect(result.details?.redis?.status).toBe('down');
    });

    it('treats an unexpected Redis response as unhealthy', async () => {
      redisMock.ping.mockResolvedValue('WRONG');

      const result = await service.getReadiness();

      expect(result.status).toBe('not ready');
      expect(result.details?.redis?.status).toBe('down');
    });

    it('checks both dependencies when both are available', async () => {
      await service.getReadiness();

      expect(dataSourceMock.query).toHaveBeenCalledTimes(1);
      expect(redisMock.ping).toHaveBeenCalledTimes(1);
    });
  });
});