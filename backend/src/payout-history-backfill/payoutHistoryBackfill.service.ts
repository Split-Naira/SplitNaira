import type {
  PayoutHistoryBackfillOptions,
  PayoutHistoryBackfillResponse,
  PayoutHistoryEventSource,
  PayoutHistoryRecord,
  PayoutHistoryRepository,
} from "./payoutHistoryBackfill.types";

export class PayoutHistoryBackfillService {
  constructor(
    private readonly eventSource: PayoutHistoryEventSource,
    private readonly repository: PayoutHistoryRepository,
  ) {}

  async run(
    options: PayoutHistoryBackfillOptions,
  ): Promise<PayoutHistoryBackfillResponse> {
    const {
      fromLedger,
      toLedger,
      dryRun = false,
      sampleSize = 10,
    } = options;

    if (fromLedger > toLedger) {
      throw new Error(
        "fromLedger must be less than or equal to toLedger.",
      );
    }

    const events = await this.eventSource.getPayoutEvents(
      fromLedger,
      toLedger,
    );

    const transactionHashes = events.map(
      (event) => event.transactionHash,
    );

    const existingTransactionHashes =
      transactionHashes.length > 0
        ? await this.repository.findExistingTransactionHashes(
            transactionHashes,
          )
        : [];

    const existingHashes = new Set(existingTransactionHashes);

    const recordsToCreate = events.filter(
      (event) => !existingHashes.has(event.transactionHash),
    );

    if (dryRun) {
      return {
        dryRun: true,
        ledgerRange: {
          from: fromLedger,
          to: toLedger,
        },
        counts: {
          eventsFound: events.length,
          recordsToCreate: recordsToCreate.length,
          existingRecords: existingTransactionHashes.length,
        },
        sampleRecords: this.getSampleRecords(
          recordsToCreate,
          sampleSize,
        ),
      };
    }

    const recordsCreated =
      recordsToCreate.length > 0
        ? await this.repository.createMany(recordsToCreate)
        : 0;

    return {
      dryRun: false,
      ledgerRange: {
        from: fromLedger,
        to: toLedger,
      },
      counts: {
        eventsFound: events.length,
        recordsCreated,
        existingRecords: existingTransactionHashes.length,
      },
    };
  }

  private getSampleRecords(
    records: PayoutHistoryRecord[],
    sampleSize: number,
  ): PayoutHistoryRecord[] {
    return records.slice(0, Math.max(0, sampleSize));
  }
}