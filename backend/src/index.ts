import "reflect-metadata";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";
import swaggerUi from "swagger-ui-express";
import { healthRouter, markStartupComplete, markShuttingDown } from "./routes/health.js";
import { opsRouter } from "./routes/ops.js";
import { isMetricsEnabled, metricsRouter } from "./routes/metrics.js";
import { splitsRouter } from "./routes/splits.js";
import { docsRouter } from "./routes/docs.js";
import { usersRouter } from "./routes/users.js";
import { authEmailRouter } from "./routes/auth-email.js";
import { transactionsRouter } from "./routes/transactions.js";
import { eventsRouter, closeAllSseConnections } from "./routes/events.js";
import { ledgerRouter } from "./routes/ledger.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { metricsMiddleware } from "./middleware/metrics.js";
import { requestTimeout } from "./middleware/timeout.js";
import {
  globalLimiter,
  readLimiter,
  writeLimiter,
  adminLimiter,
  authLimiter,
  sseConnectionLimiter,
} from "./middleware/rate-limit.js";
import {
  enforcePaymentsAdminWriteEnabled,
  requirePaymentsAdminAccess,
} from "./middleware/payments-admin.js";
import { auditAdminMutationsMiddleware } from "./middleware/audit-log.js";
import { validateEnv, printEnvDiagnostics } from "./config/env.js";
import { resolveCorsOrigins } from "./config/cors.js";
import { initDatabase, closeDatabase } from "./services/database.js";
import { logger } from "./services/logger.js";
import {
  startEventListenerService,
  stopEventListenerService,
} from "./services/EventListenerService.js";

dotenv.config();

export const app = express();

app.disable("x-powered-by");

const corsOrigin = resolveCorsOrigins(process.env);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    frameguard: { action: "deny" },
    xssFilter: true,
    noSniff: true,
  })
);
// Credentials are intentionally disabled: auth uses a bearer token in the
// Authorization header (see middleware/auth-jwt.ts), never cookies, so the
// browser never needs to send credentials cross-origin.
app.use(cors({ origin: corsOrigin, credentials: false }));
app.use(requestIdMiddleware);
app.use(express.json({ limit: "1mb" }));
app.use(express.text({ type: "text/plain", limit: "1mb" }));
app.use(metricsMiddleware);
app.use(requestTimeout());

app.use(globalLimiter);

app.use("/docs", (_req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:"
  );
  next();
});

const WALLET_ADDRESS_REGEX = /\b[GC][A-Z2-7]{55}\b/g;

export function scrubWalletAddresses(value: string): string {
  return value.replace(WALLET_ADDRESS_REGEX, "[WALLET_REDACTED]");
}

app.use(
  morgan((tokens, req, res) => {
    const requestId = res.locals.requestId ?? req.header("x-request-id") ?? "-";
    return [
      tokens.method(req, res),
      scrubWalletAddresses(tokens.url(req, res) ?? ""),
      tokens.status(req, res),
      "-",
      tokens["response-time"](req, res),
      "ms",
      "x-request-id=",
      String(requestId),
    ].join(" ");
  })
);

app.use("/health", readLimiter);
app.use(
  "/splits/admin",
  adminLimiter,
  requirePaymentsAdminAccess,
  enforcePaymentsAdminWriteEnabled,
  auditAdminMutationsMiddleware
);
app.use("/splits", (req, res, next) => {
  if (req.method === "GET") return readLimiter(req, res, next);
  return writeLimiter(req, res, next);
});
app.use("/users/register", authLimiter);
app.use("/users/login", authLimiter);
app.use("/auth", authLimiter);
app.use("/users", (req, res, next) => {
  if (req.method === "GET") return readLimiter(req, res, next);
  return writeLimiter(req, res, next);
});
app.use("/transactions", readLimiter);
app.use("/api/ledger", readLimiter);
app.use("/events", sseConnectionLimiter);

app.get("/", (_req, res) => {
  res.json({ name: "SplitNaira API", status: "ok", version: "0.1.0" });
});

app.use("/health", healthRouter);
if (isMetricsEnabled()) {
  app.use("/metrics", metricsRouter);
}
app.use("/splits", splitsRouter);
app.use("/ops", opsRouter);
app.use("/docs", docsRouter);
app.use("/auth", authEmailRouter);
app.use("/users", usersRouter);
app.use("/transactions", transactionsRouter);
app.use("/events", eventsRouter);
app.use("/api/ledger", ledgerRouter);

app.get("/api/openapi.json", async (_req, res, next) => {
  try {
    const { generateOpenApi } = await import("./openapi.js");
    const spec = generateOpenApi();
    res.json(spec);
  } catch (error) {
    next(error);
  }
});

const swaggerOptions = {
  customCss: ".swagger-ui .topbar { display: none }",
  customSiteTitle: "SplitNaira API Documentation",
  swaggerOptions: {
    url: "/api/openapi.json",
    displayOperationId: true,
    filter: true,
    showExtensions: true,
  },
};

app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(null, swaggerOptions));
app.get("/api/docs/", (_req, res) => { res.redirect("/api/docs"); });

app.use(notFoundHandler);
app.use(errorHandler);

async function initSentry(): Promise<void> {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/node");
  const scrubWallets = process.env.SENTRY_SCRUB_WALLET_ADDRESSES !== "false";
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    release: process.env.npm_package_version,
    beforeSend(event) {
      if (scrubWallets) {
        const scrubbed = JSON.stringify(event).replace(/\b[GC][A-Z2-7]{55}\b/g, "[WALLET_REDACTED]");
        return JSON.parse(scrubbed);
      }
      return event;
    },
  });
}

async function captureToSentry(err: unknown): Promise<void> {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/node");
  Sentry.captureException(err);
}

if (process.env.NODE_ENV !== "test") {
  const start = async () => {
    try {
      await initSentry();
      if (process.env.NODE_ENV !== "production") { printEnvDiagnostics(); }
      validateEnv();
      await initDatabase();
      await startEventListenerService();
      markStartupComplete();

      const port = Number(process.env.PORT ?? 3001);
      const server = app.listen(port, () => { logger.info(`Server started on port ${port}`); });

      const shutdown = async (signal: NodeJS.Signals) => {
        logger.info(`Received ${signal}. Shutting down...`);
        // Flip readiness first so load balancers stop routing new traffic
        // here immediately, well before DB/SSE/server teardown finishes.
        markShuttingDown();
        closeAllSseConnections();
        stopEventListenerService();
        await closeDatabase();
        server.close((err?: Error) => {
          if (err) { logger.error("Error during server close", { error: err }); process.exit(1); }
          logger.info("Server closed cleanly");
          process.exit(0);
        });
        const forceTimeoutMs = Number(process.env.SHUTDOWN_FORCE_TIMEOUT_MS ?? 10_000);
        setTimeout(() => { logger.warn("Force exiting after timeout"); process.exit(1); }, forceTimeoutMs).unref();
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      process.on("unhandledRejection", (reason) => {
        logger.error("Unhandled promise rejection", { reason });
        void captureToSentry(reason);
        process.exit(1);
      });
      process.on("uncaughtException", (err) => {
        logger.error("Uncaught exception", { error: err });
        void captureToSentry(err);
        process.exit(1);
      });
    } catch (err) {
      logger.error("Failed to start server", { error: err });
      void captureToSentry(err);
      process.exit(1);
    }
  };
  void start();
}
