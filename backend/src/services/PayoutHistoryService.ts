/**
 * Payout history service refactored to read from PostgreSQL database (#321).
 */

import { getDataSource } from "./database.js";
import { TransactionRecord } from "../entities/Transaction.js";
import { logger } from "./logger.js";
import { Like } from "typeorm";

export interface PayoutRecord {
  id: string;
  roundId: string;
  recipient: string;
  amount: string;
  token: string;
  timestamp: number;
  txHash: string;
  status: 'pending' | 'completed' | 'failed';
}

export interface PayoutHistoryIndex {
  getPayouts(filters?: PayoutFilters): Promise<PayoutRecord[]>;
  getPayoutById(id: string): Promise<PayoutRecord | null>;
  getPayoutsByRound(roundId: string): Promise<PayoutRecord[]>;
  getPayoutsByRecipient(recipient: string): Promise<PayoutRecord[]>;
  searchPayouts(query: string): Promise<PayoutRecord[]>;
  reindex(): Promise<void>;
  backfill(fromRound?: number): Promise<void>;
  /** Release in-memory resources. Call on graceful shutdown. */
  destroy(): void;
}

export interface PayoutFilters {
  startDate?: number;
  endDate?: number;
  recipient?: string;
  status?: 'pending' | 'completed' | 'failed';
  limit?: number;
  offset?: number;
}

export interface PayoutIndexConfig {
  storageFile: string;
  reindexInterval: number;
  maxCacheSize: number;
}

export function createPayoutHistoryService(_config?: Partial<PayoutIndexConfig>): PayoutHistoryIndex {
  return {
    async getPayouts(filters) {
      try {
        const repo = getDataSource().getRepository(TransactionRecord);
        const query = repo.createQueryBuilder("transaction");

        if (filters?.recipient) {
          query.andWhere("transaction.recipient = :recipient", { recipient: filters.recipient });
        }
        if (filters?.status) {
          query.andWhere("transaction.status = :status", { status: filters.status });
        }
        if (filters?.startDate !== undefined) {
          query.andWhere("transaction.timestamp >= :startDate", { startDate: filters.startDate });
        }
        if (filters?.endDate !== undefined) {
          query.andWhere("transaction.timestamp <= :endDate", { endDate: filters.endDate });
        }

        query.orderBy("transaction.timestamp", "DESC");

        if (filters?.offset !== undefined) {
          query.skip(filters.offset);
        }
        if (filters?.limit !== undefined) {
          query.take(filters.limit);
        }

        const records = await query.getMany();
        return records as PayoutRecord[];
      } catch (error) {
        logger.error("Error fetching payouts from database", { error });
        return [];
      }
    },

    async getPayoutsWithCount(filters) {
      try {
        const repo = getDataSource().getRepository(TransactionRecord);
        const query = repo.createQueryBuilder("transaction");

        if (filters?.recipient) {
          query.andWhere("transaction.recipient = :recipient", { recipient: filters.recipient });
        }
        if (filters?.status) {
          query.andWhere("transaction.status = :status", { status: filters.status });
        }
        if (filters?.startDate !== undefined) {
          query.andWhere("transaction.timestamp >= :startDate", { startDate: filters.startDate });
        }
        if (filters?.endDate !== undefined) {
          query.andWhere("transaction.timestamp <= :endDate", { endDate: filters.endDate });
        }

        query.orderBy("transaction.timestamp", "DESC");

        const [records, total] = await query.getManyAndCount();
        return { records: records as PayoutRecord[], total };
      } catch (error) {
        logger.error("Error fetching payouts with count from database", { error });
        return { records: [], total: 0 };
      }
    },

    async getPayoutById(id) {
      try {
        const repo = getDataSource().getRepository(TransactionRecord);
        const record = await repo.findOneBy({ id });
        return (record as PayoutRecord) ?? null;
      } catch (error) {
        logger.error("Error fetching payout by ID", { id, error });
        return null;
      }
    },

    async getPayoutsByRound(roundId) {
      try {
        const repo = getDataSource().getRepository(TransactionRecord);
        const records = await repo.findBy({ roundId });
        return records as PayoutRecord[];
      } catch (error) {
        logger.error("Error fetching payouts by round", { roundId, error });
        return [];
      }
    },

    async getPayoutsByRecipient(recipient) {
      return this.getPayouts({ recipient });
    },

    async searchPayouts(query) {
      try {
        const repo = getDataSource().getRepository(TransactionRecord);
        const records = await repo.find({
          where: [
            { recipient: Like(`%${query}%`) },
            { txHash: Like(`%${query}%`) },
            { roundId: Like(`%${query}%`) }
          ]
        });
        return records as PayoutRecord[];
      } catch (error) {
        logger.error("Error searching payouts", { query, error });
        return [];
      }
    },

    async reindex() {
      logger.info("Reindexing database payout history...");
    },

    async backfill(fromRound) {
      logger.info(`Backfilling from round ${fromRound ?? 0}`);
    },

    destroy() {
      // Database connection lifetime is managed globally. No-op.
    }
  };
}
