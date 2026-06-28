import "reflect-metadata";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";
import swaggerUi from "swagger-ui-express";
import { healthRouter, markStartupComplete } from "./routes/health.js";
import { opsRouter } from "./routes/ops.js";
import { isMetricsEnabled, metricsRouter } from "./routes/metrics.js";
import { splitsRouter } from "./routes/splits.js";
import { docsRouter } from "./routes/docs.js";
import { usersRouter } from "./routes/users.js";
import { transactionsRouter } from "./routes/transactions.js";
import { eventsRouter } from "./routes/events.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { metricsMiddleware } from "./middleware/metrics.js";
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
import { eventsRouter } from "./routes/events.js";
import { validateEnv, printEnvDiagnostics } from "./config/env.js";
import { initDatabase, closeDatabase } from "./services/database.js";
import { logger } from "./services/logger.js";
import {
  startEventListenerService,
  stopEventListenerService,
} from "./services/EventListenerService.js";

dotenv.config();

export const app = express();

app.disable("x-powered-by");

const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  : ["http://localhost:3000"];

const corsOrigin = corsOrigins.length > 0 ? corsOrigins : false;

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
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: "1mb" }));
app.use(requestIdMiddleware);
app.use(metricsMiddleware);

// Global safety-net — must run before all route-specific limiters (#290)
app.use(globalLimiter);

// Swagger UI needs inline scripts/styles — relax CSP only for /docs
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
// Auth endpoints get a stricter per-IP limiter to block credential stuffing
app.use("/users/register", authLimiter);
app.use("/users/login", authLimiter);
app.use("/users", (req, res, next) => {
  if (req.method === "GET") return readLimiter(req, res, next);
  return writeLimiter(req, res, next);
});
app.use("/transactions", readLimiter);
app.use("/events", sseConnectionLimiter);

app.get("/", (_req, res) => {
  res.json({
    name: "SplitNaira API",
    status: "ok",
    version: "0.1.0",
  });
});

app.use("/health", healthRouter);
if (isMetricsEnabled()) {
  app.use("/metrics", metricsRouter);
}
app.use("/splits", splitsRouter);
app.use("/ops", opsRouter);
app.use("/docs", docsRouter);
app.use("/users", usersRouter);
app.use("/transactions", transactionsRouter);
app.use("/events", eventsRouter);

// ─── OpenAPI & Swagger Documentation ──────────────────────────────────────────

// Serve OpenAPI spec as JSON
app.get("/api/openapi.json", async (_req, res, next) => {
  try {
    const { generateOpenApi } = await import("./openapi.js");
    const spec = generateOpenApi();
    res.json(spec);
  } catch (error) {
    next(error);
  }
});

// Serve Swagger UI at /api/docs
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

// Redirect /api/docs/ to /api/docs
app.get("/api/docs/", (_req, res) => {
  res.redirect("/api/docs");
});

app.use(notFoundHandler);
app.use(errorHandler);

// Lazily initialise Sentry only when SENTRY_DSN is set. Dynamic import avoids
// loading the @sentry/node OpenTelemetry instrumentation in test/CI environments
// where no DSN is configured, which would otherwise patch http internals.
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
        const scrubbed = JSON.stringify(event).replace(
          /\b[GC][A-Z2-7]{55}\b/g,
          "[WALLET_REDACTED]"
        );
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

      if (process.env.NODE_ENV !== "production") {
        printEnvDiagnostics();
      }
      validateEnv();

      await initDatabase();
      await startEventListenerService();
      markStartupComplete();

      const port = Number(process.env.PORT ?? 3001);
      const server = app.listen(port, () => {
        logger.info(`Server started on port ${port}`);
      });

      // Graceful shutdown
      const shutdown = async (signal: NodeJS.Signals) => {
        logger.info(`Received ${signal}. Shutting down...`);
        stopEventListenerService();
        await closeDatabase();
        server.close((err?: Error) => {
          if (err) {
            logger.error("Error during server close", { error: err });
            process.exit(1);
          }
          logger.info("Server closed cleanly");
          process.exit(0);
        });

        // Fallback: force exit after timeout
        const forceTimeoutMs = Number(process.env.SHUTDOWN_FORCE_TIMEOUT_MS ?? 10_000);
        setTimeout(() => {
          logger.warn("Force exiting after timeout");
          process.exit(1);
        }, forceTimeoutMs).unref();
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      // Fatal error handlers
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
