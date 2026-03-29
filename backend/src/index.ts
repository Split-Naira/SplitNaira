import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";

import { healthRouter } from "./routes/health.js";
import { splitsRouter } from "./routes/splits.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { requestIdMiddleware } from "./middleware/request-id.js";

dotenv.config();

export const app = express();

app.disable("x-powered-by");

const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean)
  : ["http://localhost:3000"];

const corsOrigin = corsOrigins.length > 0 ? corsOrigins : false;

const publicLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000),
  limit: Number(process.env.RATE_LIMIT_MAX ?? 100),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const requestId = res.locals.requestId;
    res.status(429).json({
      error: "rate_limited",
      message: "Too many requests.",
      requestId
    });
  }
});

app.use(helmet());
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: "1mb" }));
app.use(requestIdMiddleware);
app.use(
  morgan((tokens, req, res) => {
    const requestId = res.locals.requestId ?? req.header("x-request-id") ?? "-";
    return [
      tokens.method(req, res),
      tokens.url(req, res),
      tokens.status(req, res),
      "-",
      tokens["response-time"](req, res),
      "ms",
      "x-request-id=",
      String(requestId)
    ].join(" ");
  })
);

app.use(["/health", "/splits"], publicLimiter);

app.get("/", (_req, res) => {
  res.json({
    name: "SplitNaira API",
    status: "ok",
    version: "0.1.0"
  });
});

app.use("/health", healthRouter);
app.use("/splits", splitsRouter);

app.use(notFoundHandler);
app.use(errorHandler);

if (process.env.NODE_ENV !== "test") {
  // Startup wrapper to allow clean fatal handling
  const start = async () => {
    try {
      const port = Number(process.env.PORT ?? 3001);
      const server = app.listen(port, () => {
        console.log(`[startup] SplitNaira API listening on :${port}`);
      });

      // Graceful shutdown
      const shutdown = (signal: NodeJS.Signals) => {
        console.log(`[shutdown] Received ${signal}. Closing server...`);
        // Stop accepting new connections and wait for in-flight to complete
        server.close((err?: Error) => {
          if (err) {
            console.error("[shutdown] Error during server close:", err);
            process.exit(1);
          }
          console.log("[shutdown] Server closed cleanly. Exiting.");
          process.exit(0);
        });

        // Fallback: force exit after timeout
        const forceTimeoutMs = Number(process.env.SHUTDOWN_FORCE_TIMEOUT_MS ?? 10_000);
        setTimeout(() => {
          console.warn("[shutdown] Force exiting after timeout.");
          process.exit(1);
        }, forceTimeoutMs).unref();
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      // Fatal error handlers
      process.on("unhandledRejection", (reason) => {
        console.error("[fatal] Unhandled promise rejection:", reason);
        // Exit to allow orchestrator to restart
        process.exit(1);
      });
      process.on("uncaughtException", (err) => {
        console.error("[fatal] Uncaught exception:", err);
        process.exit(1);
      });
    } catch (err) {
      console.error("[startup] Failed to start server:", err);
      process.exit(1);
    }
  };
  // Immediately invoke
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  start();
}

