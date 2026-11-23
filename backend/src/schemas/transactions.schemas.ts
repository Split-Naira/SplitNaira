import { z } from "zod";
import { stellarAddressSchema } from "./splits.js";

/** Hard ceiling for any transaction page, independent of the caller (#1259). */
export const MAX_TRANSACTION_PAGE_SIZE = 100;

const transactionPageFields = {
  limit: z.coerce.number().int().min(1).max(MAX_TRANSACTION_PAGE_SIZE).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  /** Opaque `(timestamp, id)` cursor returned as `nextCursor` by a prior page. */
  cursor: z.string().min(1).max(512).optional(),
};

// Transaction history query schema
export const transactionHistoryQuerySchema = z.object({
  walletAddress: z.string().regex(/^G[A-Z2-7]{55}$/, {
    message: "Must be a valid Stellar account ID (G…)",
  }).optional(),
  startDate: z.coerce.number().int().positive().optional(),
  endDate: z.coerce.number().int().positive().optional(),
  status: z.enum(["pending", "completed", "failed"]).optional(),
  ...transactionPageFields,
});

// Recipient listing accepts the same page controls as /history (#1259).
export const transactionRecipientQuerySchema = z.object(transactionPageFields);

export const payoutAttemptSchema = z.object({
  txHash: z.string().regex(/^[0-9a-fA-F]{64}$/),
  projectId: z.string().min(1).max(32).regex(/^[a-zA-Z0-9_]+$/),
  sourceAccount: stellarAddressSchema.refine((value) => value.startsWith("G")),
});

export const payoutRecoveryStatusSchema = z.object({
  txHash: z.string().describe("Lowercase hex transaction hash used as the recovery idempotency key"),
  projectId: z.string().describe("Project the payout belongs to"),
  sourceAccount: z.string().describe("Stellar account that signed and submitted the payout"),
  networkPassphrase: z.string().describe("Network the transaction was submitted to"),
  submittedAt: z.number().int().describe("Unix epoch milliseconds when the attempt was first registered"),
  status: z
    .enum(["pending", "completed", "failed"])
    .describe(
      "`pending` means the outcome is unknown: the transaction was accepted for submission but has " +
        "not been confirmed or rejected on-chain yet. Keep polling this endpoint; do not resubmit. " +
        "`completed` is final. `failed` is final and is the only state in which a retry may be safe.",
    ),
  failureCode: z
    .string()
    .nullable()
    .describe(
      "Null unless `status` is `failed`. `transaction_failed` means the network included a failed " +
        "transaction (see `failureLedger`). `transaction_expired` means the hash was still NOT_FOUND " +
        "after the submission validity window, so it will never be included.",
    ),
  failureLedger: z
    .number()
    .int()
    .nullable()
    .describe("Ledger containing the failed transaction, or null for `transaction_expired`"),
  lastCheckedAt: z
    .number()
    .int()
    .nullable()
    .describe("Unix epoch milliseconds of the last network reconciliation, or null before the first check"),
});

// Transaction export query schema (#1332).
//
// No `walletAddress` field: export is always scoped to the authenticated
// caller (see the /transactions/export route), so accepting one here would
// invite it being silently ignored — or worse, misread as "export someone
// else's transactions."
export const transactionExportQuerySchema = z.object({
  format: z.enum(["csv", "json"]).default("csv"),
  startDate: z.coerce.number().int().positive().optional(),
  endDate: z.coerce.number().int().positive().optional(),
  status: z.enum(["pending", "completed", "failed"]).optional(),
  // Only meaningful for format=json, which returns one page rather than
  // streaming the full result set.
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// Transaction record schema
export const transactionRecordSchema = z.object({
  id: z.string(),
  roundId: z.string(),
  recipient: z.string(),
  amount: z.string(),
  token: z.string(),
  timestamp: z.number().int(),
  txHash: z.string(),
  status: z.enum(["pending", "completed", "failed"]),
});

export const transactionReceiptSchema = z.object({
  reference: z.string(),
  amount: z.string(),
  token: z.string(),
  date: z.iso.datetime(),
  network: z.string(),
  status: z.enum(["pending", "completed", "failed"]),
  recipient: z.string(),
  projectId: z.string(),
});

// Transaction history response schema
export const transactionHistoryResponseSchema = z.object({
  transactions: z.array(transactionRecordSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int(),
  offset: z.number().int(),
  hasMore: z.boolean(),
  /** Cursor for the next page, or null on the last page. */
  nextCursor: z.string().nullable(),
});

export type TransactionHistoryQuery = z.infer<typeof transactionHistoryQuerySchema>;
export type TransactionRecipientQuery = z.infer<typeof transactionRecipientQuerySchema>;
export type TransactionExportQuery = z.infer<typeof transactionExportQuerySchema>;
export type TransactionRecord = z.infer<typeof transactionRecordSchema>;
export type TransactionHistoryResponse = z.infer<typeof transactionHistoryResponseSchema>;
