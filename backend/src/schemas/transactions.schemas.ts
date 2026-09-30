import { z } from "zod";

// Transaction history query schema
export const transactionHistoryQuerySchema = z.object({
  walletAddress: z.string().regex(/^G[A-Z2-7]{55}$/, {
    message: "Must be a valid Stellar account ID (G…)",
  }).optional(),
  startDate: z.coerce.number().int().positive().optional(),
  endDate: z.coerce.number().int().positive().optional(),
  status: z.enum(["pending", "completed", "failed"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
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
});

export type TransactionHistoryQuery = z.infer<typeof transactionHistoryQuerySchema>;
export type TransactionExportQuery = z.infer<typeof transactionExportQuerySchema>;
export type TransactionRecord = z.infer<typeof transactionRecordSchema>;
export type TransactionHistoryResponse = z.infer<typeof transactionHistoryResponseSchema>;
