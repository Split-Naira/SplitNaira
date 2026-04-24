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
}

export function createPayoutHistoryService(config?: Partial<PayoutIndexConfig>): PayoutHistoryIndex {
  const storageFile = config?.storageFile || './data/payout-history.json';
  const _reindexIntervalMs = config?.reindexInterval || 3600000;

  let cache: Map<string, PayoutRecord> = new Map();

  async function loadFromStorage(): Promise<void> {
    try {
      const fs = await import("node:fs/promises");
      const data = await fs.readFile(storageFile, "utf8");
      const records: PayoutRecord[] = JSON.parse(data);
      for (const record of records) {
        cache.set(record.id, record);
      }
    } catch {
      cache = new Map();
    }
  }

  async function saveToStorage(): Promise<void> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const records = Array.from(cache.values());
    await fs.mkdir(path.dirname(storageFile), { recursive: true });
    await fs.writeFile(storageFile, JSON.stringify(records, null, 2), "utf8");
  }

  return {
    async getPayouts(filters) {
      await loadFromStorage();
      let results = Array.from(cache.values());

      if (filters?.startDate) {
        results = results.filter(r => r.timestamp >= filters.startDate!);
      }
      if (filters?.endDate) {
        results = results.filter(r => r.timestamp <= filters.endDate!);
      }
      if (filters?.recipient) {
        results = results.filter(r => r.recipient === filters.recipient);
      }
      if (filters?.status) {
        results = results.filter(r => r.status === filters.status);
      }

      results.sort((a, b) => b.timestamp - a.timestamp);

      if (filters?.offset) {
        results = results.slice(filters.offset);
      }
      if (filters?.limit) {
        results = results.slice(0, filters.limit);
      }

      return results;
    },

    async getPayoutById(id) {
      await loadFromStorage();
      return cache.get(id) || null;
    },

    async getPayoutsByRound(roundId) {
      await loadFromStorage();
      return Array.from(cache.values()).filter(r => r.roundId === roundId);
    },

    async getPayoutsByRecipient(recipient) {
      return this.getPayouts({ recipient });
    },

    async searchPayouts(query) {
      await loadFromStorage();
      const q = query.toLowerCase();
      return Array.from(cache.values()).filter(r =>
        r.recipient.toLowerCase().includes(q) ||
        r.txHash.toLowerCase().includes(q) ||
        r.roundId.toLowerCase().includes(q)
      );
    },

    async reindex() {
      await loadFromStorage();
      await saveToStorage();
    },

    async backfill(fromRound) {
      // Placeholder: integrate with Stellar event indexer
      console.log(`Backfilling from round ${fromRound || 0}`);
    }
  };
}
