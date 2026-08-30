export interface PayoutHistoryBackfillOptions {
  fromLedger: number;
  toLedger: number;
  dryRun?: boolean;
  sampleSize?: number;
}

export interface PayoutHistoryRecord {
  id: string;
  payoutId: string;
  transactionHash: string;
  ledger: number;
  amount: string;
  recipient: string;
  timestamp?: string;
}

export interface PayoutHistoryBackfillPreview {
  dryRun: true;
  ledgerRange: {
    from: number;
    to: number;
  };
  counts: {
    eventsFound: number;
    recordsToCreate: number;
    existingRecords: number;
  };
  sampleRecords: PayoutHistoryRecord[];
}

export interface PayoutHistoryBackfillResult {
  dryRun: false;
  ledgerRange: {
    from: number;
    to: number;
  };
  counts: {
    eventsFound: number;
    recordsCreated: number;
    existingRecords: number;
  };
}

export type PayoutHistoryBackfillResponse =
  | PayoutHistoryBackfillPreview
  | PayoutHistoryBackfillResult;

export interface PayoutHistoryEventSource {
  getPayoutEvents(
    fromLedger: number,
    toLedger: number,
  ): Promise<PayoutHistoryRecord[]>;
}

export interface PayoutHistoryRepository {
  findExistingTransactionHashes(
    transactionHashes: string[],
  ): Promise<string[]>;

  createMany(records: PayoutHistoryRecord[]): Promise<number>;
}