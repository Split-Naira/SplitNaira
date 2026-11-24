import { Router, Request, Response, NextFunction } from "express";
import {
  transactionHistoryQuerySchema,
  transactionExportQuerySchema,
  transactionRecipientQuerySchema,
  payoutAttemptSchema,
} from "../schemas/transactions.schemas.js";
import { AppError, ErrorCode, ErrorType } from "../lib/errors.js";
import { toCsvRow } from "../lib/csv.js";
import {
  createPayoutHistoryService,
  type PayoutPage,
  type PayoutRecord,
} from "../services/PayoutHistoryService.js";
import {
  decodeTransactionCursor,
  encodeTransactionCursor,
  InvalidTransactionCursorError,
  type TransactionCursor,
} from "../lib/keyset-cursor.js";
import { authJwtMiddleware } from "../middleware/auth-jwt.js";
import { sendErrorResponse } from "../middleware/error.js";
import { logger } from "../services/logger.js";
import { getEnv } from "../config/env.js";
import { getStellarRpcServer, executeWithRetry } from "../services/stellar.js";
import { getDataSource } from "../services/database.js";
import { TransactionAttempt } from "../entities/TransactionAttempt.js";
import {
  PayoutAttemptConflictError,
  registerPayoutAttempt,
  updatePayoutAttemptFromObservation,
  type PayoutAuditContext,
} from "../services/transaction-recovery.js";
import { hashIp } from "../middleware/payments-admin.js";

export const transactionsRouter = Router();

// Initialize payout history service
const payoutHistoryService = createPayoutHistoryService();

// Hard ceiling on rows a single export request can stream, independent of
// the caller's own rate limit. Protects the DB and the response from an
// unbounded query even for a fully authorized, well-intentioned caller.
const EXPORT_MAX_ROWS = 50_000;

/** Correlation metadata for payout transition audit rows (#1643). */
function payoutAuditContext(req: Request, res: Response): PayoutAuditContext {
  const requestId = res.locals.requestId;
  return {
    ...(typeof requestId === "string" && requestId ? { correlationId: requestId } : {}),
    ipHash: hashIp(req.ip),
  };
}

function formatPayoutAttempt(attempt: TransactionAttempt) {
  return {
    txHash: attempt.txHash,
    projectId: attempt.projectId,
    sourceAccount: attempt.sourceAccount,
    networkPassphrase: attempt.networkPassphrase,
    submittedAt: attempt.submittedAt,
    status: attempt.status,
    failureCode: attempt.failureCode,
    failureLedger: attempt.failureLedger,
    lastCheckedAt: attempt.lastCheckedAt,
  };
}

transactionsRouter.post(
  "/recovery/attempts",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = payoutAttemptSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(
          ErrorType.VALIDATION,
          ErrorCode.VALIDATION_ERROR,
          "Invalid payout attempt metadata.",
          undefined,
          parsed.error.flatten(),
        );
      }

      const networkPassphrase = getEnv().SOROBAN_NETWORK_PASSPHRASE;
      const attempt = await registerPayoutAttempt(
        getDataSource(),
        {
          txHash: parsed.data.txHash.toLowerCase(),
          projectId: parsed.data.projectId,
          sourceAccount: parsed.data.sourceAccount,
          networkPassphrase,
        },
        undefined,
        payoutAuditContext(req, res),
      );
      return res.status(200).json(formatPayoutAttempt(attempt));
    } catch (error) {
      if (error instanceof PayoutAttemptConflictError) {
        return sendErrorResponse(res, 409, "payout_attempt_conflict", error.message);
      }
      return next(error);
    }
  },
);

transactionsRouter.get(
  "/recovery/attempts/:txHash",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const txHashParam = req.params.txHash;
      const txHash = Array.isArray(txHashParam) ? txHashParam[0] : txHashParam;
      if (!txHash || !/^[a-fA-F0-9]{64}$/.test(txHash)) {
        throw new AppError(
          ErrorType.VALIDATION,
          ErrorCode.VALIDATION_ERROR,
          "Invalid transaction hash.",
        );
      }

      const dataSource = getDataSource();
      const repository = dataSource.getRepository(TransactionAttempt);
      const attempt = await repository.findOneBy({ txHash: txHash.toLowerCase() });
      if (!attempt) {
        throw new AppError(ErrorType.RPC, ErrorCode.NOT_FOUND, "Payout attempt not found.");
      }

      const observation = await executeWithRetry(
        () => getStellarRpcServer().getTransaction(attempt.txHash),
        { operation: "recoverPayoutTransaction" },
      );
      if (
        observation.status !== "NOT_FOUND" &&
        observation.status !== "SUCCESS" &&
        observation.status !== "FAILED"
      ) {
        throw new Error("Soroban RPC returned an unsupported transaction status.");
      }
      const reconciled = await updatePayoutAttemptFromObservation(
        dataSource,
        attempt,
        {
          status: observation.status,
          ...("ledger" in observation && typeof observation.ledger === "number"
            ? { ledger: observation.ledger }
            : {}),
        },
        undefined,
        payoutAuditContext(req, res),
      );
      return res.status(200).json(formatPayoutAttempt(reconciled));
    } catch (error) {
      return next(error);
    }
  },
);

function decodePageCursor(raw: string | undefined): TransactionCursor | undefined {
  if (raw === undefined) return undefined;

  try {
    return decodeTransactionCursor(raw);
  } catch (error) {
    if (error instanceof InvalidTransactionCursorError) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Invalid pagination cursor.",
        undefined,
        { cursor: "invalid" },
      );
    }
    throw error;
  }
}

function buildPageMetadata(page: PayoutPage, limit: number, offset: number) {
  const last = page.records.at(-1);
  const nextCursor =
    page.hasMore && last
      ? encodeTransactionCursor({ timestamp: last.timestamp, id: last.id })
      : null;

  return { limit, offset, hasMore: page.hasMore, nextCursor };
}

function formatTransactionRow(record: PayoutRecord): (string | number)[] {
  return [
    record.id,
    record.roundId,
    record.recipient,
    record.amount,
    record.token,
    new Date(record.timestamp * 1000).toISOString(),
    record.txHash,
    record.status,
  ];
}

/**
 * @openapi
 * GET /transactions/history
 * summary: Query payout transaction history
 * description: Returns paginated payout records with optional wallet, date, and status filters.
 * tags: [Transactions]
 */
transactionsRouter.get("/history", async (req: Request, res: Response, next: NextFunction) => {
  try {
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

    const { walletAddress, startDate, endDate, status, limit, offset, cursor } = parsed.data;
    const decodedCursor = decodePageCursor(cursor);

    logger.info("Fetching transaction history", {
      walletAddress,
      startDate,
      endDate,
      status,
      limit,
      offset,
      cursor: decodedCursor ? "provided" : "none",
    });

    const page = await payoutHistoryService.getPayoutsPage({
      recipient: walletAddress,
      startDate,
      endDate,
      status,
      limit,
      offset,
      cursor: decodedCursor,
    });

    return res.status(200).json({
      transactions: page.records,
      total: page.total,
      ...buildPageMetadata(page, limit, offset),
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * @openapi
 * GET /transactions/export
 * summary: Export the authenticated wallet's own transaction history
 * description: >
 *   Requires a valid bearer token. Always scoped to the authenticated
 *   wallet — a caller can never export another wallet's transactions,
 *   regardless of query parameters. `format=csv` (default) streams the
 *   full matching result set as an injection-safe CSV in fixed-size
 *   batches, capped at 50,000 rows. `format=json` returns paginated
 *   records with stable keyset cursor pagination, matching /transactions/history.
 * tags: [Transactions]
 */
transactionsRouter.get("/export", authJwtMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = transactionExportQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Invalid query parameters.",
        undefined,
        parsed.error.flatten()
      );
    }

    const { format, startDate, endDate, status, limit, offset, cursor } = parsed.data;
    // Access control: the export is always scoped to the authenticated
    // caller's own wallet, taken from the verified token — never from a
    // request parameter — so one user cannot export another's transactions.
    const recipient = req.user!.walletAddress;
    const decodedCursor = decodePageCursor(cursor);

    logger.info("Exporting transaction history", {
      recipient,
      format,
      startDate,
      endDate,
      status,
      limit,
      offset,
      cursor: decodedCursor ? "provided" : "none",
    });

    if (format === "json") {
      const page = await payoutHistoryService.getPayoutsPage({
        recipient,
        startDate,
        endDate,
        status,
        limit,
        offset,
        cursor: decodedCursor,
      });
      return res.status(200).json({
        transactions: page.records,
        total: page.total,
        ...buildPageMetadata(page, limit, offset),
      });
    }

    // format === "csv": stream the full authorized result set.
    const filename = `splitnaira-transactions-${Date.now()}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");

    res.write(toCsvRow(["id", "roundId", "recipient", "amount", "token", "timestamp", "txHash", "status"]));

    let rowsWritten = 0;
    let truncated = false;
    for await (const batch of payoutHistoryService.iteratePayouts({ recipient, startDate, endDate, status })) {
      for (const record of batch) {
        if (rowsWritten >= EXPORT_MAX_ROWS) {
          truncated = true;
          break;
        }
        res.write(toCsvRow(formatTransactionRow(record)));
        rowsWritten++;
      }
      if (truncated) break;
    }

    if (truncated) {
      logger.warn("Transaction export truncated at row cap", { recipient, cap: EXPORT_MAX_ROWS });
    }

    return res.end();
  } catch (error) {
    return next(error);
  }
});

/** A receipt is generated on demand from the indexed transaction, never from request-supplied fields. */
transactionsRouter.get("/receipt/:txHash", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const txHashParam = req.params.txHash;
    const txHash = Array.isArray(txHashParam) ? txHashParam[0] : txHashParam;
    if (!txHash || !/^[a-fA-F0-9]{64}$/.test(txHash)) {
      throw new AppError(ErrorType.VALIDATION, ErrorCode.VALIDATION_ERROR, "Invalid transaction hash.");
    }

    const transaction = await payoutHistoryService.getPayoutByTxHash(txHash);
    if (!transaction) {
      throw new AppError(ErrorType.RPC, ErrorCode.NOT_FOUND, "Transaction not found.");
    }

    return res.status(200).json({
      reference: transaction.txHash,
      amount: transaction.amount,
      token: transaction.token,
      date: new Date(transaction.timestamp * 1000).toISOString(),
      network: getEnv().SOROBAN_NETWORK_PASSPHRASE,
      status: transaction.status,
      recipient: transaction.recipient,
      projectId: transaction.roundId,
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * @openapi
 * GET /transactions/{txHash}
 * summary: Get transaction by hash
 * description: Returns a single payout record matching the Stellar transaction hash.
 * tags: [Transactions]
 */
transactionsRouter.get("/:txHash", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const txHashParam = req.params.txHash;
    const txHash = Array.isArray(txHashParam) ? txHashParam[0] : txHashParam;

    if (!txHash || txHash.length === 0) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Transaction hash is required."
      );
    }

    logger.info("Fetching transaction by hash", { txHash });

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
 * @openapi
 * GET /transactions/recipient/{walletAddress}
 * summary: List transactions for a recipient
 * description: Returns all payout records sent to the given Stellar wallet address.
 * tags: [Transactions]
 */
transactionsRouter.get("/recipient/:walletAddress", async (req: Request, res: Response, next: NextFunction) => {
  try {
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

    const parsedQuery = transactionRecipientQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Invalid query parameters.",
        undefined,
        parsedQuery.error.flatten()
      );
    }

    const recipient = parsed.data;
    if (!recipient) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Wallet address is required."
      );
    }

    const { limit, offset, cursor } = parsedQuery.data;
    const decodedCursor = decodePageCursor(cursor);

    logger.info("Fetching transactions for recipient", {
      walletAddress,
      limit,
      offset,
      cursor: decodedCursor ? "provided" : "none",
    });

    const page = await payoutHistoryService.getPayoutsPage({
      recipient,
      limit,
      offset,
      cursor: decodedCursor,
    });

    return res.status(200).json({
      transactions: page.records,
      total: page.total,
      walletAddress: recipient,
      ...buildPageMetadata(page, limit, offset),
    });
  } catch (error) {
    return next(error);
  }
});
