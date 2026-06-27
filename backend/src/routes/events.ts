import { Router, type Request, type Response } from "express";
import { AppDataSource } from "../data-source.js";
import { Transaction as TransactionRecord } from "../entities/Transaction.js";
import { logger } from "../services/logger.js";

export const eventsRouter = Router();

eventsRouter.get("/transactions/:txHash", async (req: Request, res: Response) => {
  const { txHash } = req.params;

  if (!txHash || typeof txHash !== "string") {
    res.status(400).json({ error: "Invalid transaction hash" });
    return;
  }

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering

  logger.info(`SSE connection opened for transaction: ${txHash}`);

  // Check if transaction already exists
  const repo = AppDataSource.getRepository(TransactionRecord);

  try {
    const existing = await repo.findOneBy({ txHash });

    if (existing) {
      // Transaction found immediately - send and close
      const data = JSON.stringify({
        status: "completed",
        record: {
          txHash: existing.txHash,
          projectId: existing.projectId,
          action: existing.action,
          amount: existing.amount,
          createdAt: existing.createdAt,
        },
      });
      res.write(`data: ${data}\n\n`);
      res.end();
      logger.info(`Transaction ${txHash} found immediately, SSE closed`);
      return;
    }
  } catch (error) {
    logger.error(`Error querying transaction ${txHash}:`, { error });
    res.write(`data: ${JSON.stringify({ status: "error", message: "Database error" })}\n\n`);
    res.end();
    return;
  }

  // Transaction not found yet - poll until it appears or client disconnects
  let pollCount = 0;
  const maxPolls = 60; // 60 * 3s = 3 minutes max
  const pollInterval = 3000; // 3 seconds

  const pollTimer = setInterval(async () => {
    pollCount++;

    try {
      const record = await repo.findOneBy({ txHash });

      if (record) {
        const data = JSON.stringify({
          status: "completed",
          record: {
            txHash: record.txHash,
            projectId: record.projectId,
            action: record.action,
            amount: record.amount,
            createdAt: record.createdAt,
          },
        });
        res.write(`data: ${data}\n\n`);
        clearInterval(pollTimer);
        res.end();
        logger.info(`Transaction ${txHash} found after ${pollCount} polls, SSE closed`);
        return;
      }

      // Heartbeat to keep connection alive
      res.write(`: heartbeat ${pollCount}\n\n`);

      if (pollCount >= maxPolls) {
        res.write(`data: ${JSON.stringify({ status: "timeout" })}\n\n`);
        clearInterval(pollTimer);
        res.end();
        logger.warn(`Transaction ${txHash} timed out after ${maxPolls} polls`);
      }
    } catch (error) {
      logger.error(`Error polling transaction ${txHash}:`, { error });
      res.write(`data: ${JSON.stringify({ status: "error", message: "Polling error" })}\n\n`);
      clearInterval(pollTimer);
      res.end();
    }
  }, pollInterval);

  // Clean up on client disconnect
  req.on("close", () => {
    clearInterval(pollTimer);
    logger.info(`SSE connection closed by client for transaction: ${txHash}`);
  });
});
