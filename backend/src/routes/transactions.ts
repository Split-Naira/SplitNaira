import { Router, Request, Response, NextFunction } from "express";
import { transactionHistoryQuerySchema } from "../schemas/transactions.schemas.js";
import { AppError, ErrorCode, ErrorType } from "../lib/errors.js";
import { createPayoutHistoryService } from "../services/PayoutHistoryService.js";
import { logger } from "../services/logger.js";

export const transactionsRouter = Router();

// Initialize payout history service
const payoutHistoryService = createPayoutHistoryService();

/**
 * GET /transactions/history
 * Fetch transaction history with optional filters
 */
transactionsRouter.get("/history", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = res.locals.requestId;

    // Validate query parameters
    const parsed = transactionHistoryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Invalid query parameters.",
        undefined,
        parsed.error.flatten()
      );
    }

    const { walletAddress, startDate, endDate, status, limit, offset } = parsed.data;

    logger.info("Fetching transaction history", {
      walletAddress,
      startDate,
      endDate,
      status,
      limit,
      offset,
      requestId
    });

    const { records, total } = await payoutHistoryService.getPayoutsWithCount({
      recipient: walletAddress,
      startDate,
      endDate,
      status,
      limit,
      offset
    });

    return res.status(200).json({
      transactions: records,
      total,
      limit,
      offset
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /transactions/:txHash
 * Get a specific transaction by transaction hash
 */
transactionsRouter.get("/:txHash", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = res.locals.requestId;
    const txHashParam = req.params.txHash;
    const txHash = Array.isArray(txHashParam) ? txHashParam[0] : txHashParam;

    if (!txHash || txHash.length === 0) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Transaction hash is required."
      );
    }

    logger.info("Fetching transaction by hash", { txHash, requestId });

    // Search for the transaction by hash
    const results = await payoutHistoryService.searchPayouts(txHash);
    const transaction = results.find(t => t.txHash === txHash);

    if (!transaction) {
      throw new AppError(
        ErrorType.RPC,
        ErrorCode.NOT_FOUND,
        `Transaction with hash ${txHash} not found.`
      );
    }

    return res.status(200).json(transaction);
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /transactions/recipient/:walletAddress
 * Get all transactions for a specific recipient
 */
transactionsRouter.get("/recipient/:walletAddress", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = res.locals.requestId;
    const { walletAddress } = req.params;

    // Validate wallet address format
    const walletAddressSchema = transactionHistoryQuerySchema.shape.walletAddress;
    const parsed = walletAddressSchema.safeParse(walletAddress);
    
    if (!parsed.success) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Invalid wallet address format.",
        undefined,
        parsed.error.flatten()
      );
    }

    logger.info("Fetching transactions for recipient", { walletAddress, requestId });

    const recipient = parsed.data;
    if (!recipient) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Wallet address is required."
      );
    }

    const transactions = await payoutHistoryService.getPayoutsByRecipient(recipient);

    return res.status(200).json({
      transactions,
      total: transactions.length,
      walletAddress: parsed.data
    });
  } catch (error) {
    return next(error);
  }
});
