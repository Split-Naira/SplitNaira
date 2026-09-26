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
export type TransactionRecord = z.infer<typeof transactionRecordSchema>;
export type TransactionHistoryResponse = z.infer<typeof transactionHistoryResponseSchema>;
