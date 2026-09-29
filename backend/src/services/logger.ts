import winston from "winston";
import { getRequestId } from "./request-context.js";

const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const logColors = {
  error: "red",
  warn: "yellow",
  info: "green",
  http: "magenta",
  debug: "cyan",
};

winston.addColors(logColors);

// Secrets that must never appear in log output.
const SCRUB_KEYS = new Set([
  "password",
  "passwd",
  "secret",
  "secretkey",
  "token",
  "accesstoken",
  "refreshtoken",
  "jwt",
  "authorization",
  "cookie",
  "session",
  "sessionid",
  "apikey",
  "private_key",
  "privatekey",
  "mnemonic",
  "seed",
  "cardnumber",
  "cvv",
  "cvc",
  "securitycode",
  "accountnumber",
  "routingnumber",
  "bankaccountnumber",
  "iban",
  "paymenttoken",
  "database_url",
  "databaseurl",
  "sentry_dsn",
  "sentrydsn",
  "walletaddress",
]);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function scrubValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(scrubValue);
  }
  if (value !== null && typeof value === "object") {
    return scrubSecrets(value as Record<string, unknown>);
  }
  return value;
}

function scrubSecrets(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SCRUB_KEYS.has(normalizeKey(k))) {
      result[k] = "[REDACTED]";
    } else {
      result[k] = scrubValue(v);
    }
  }
  return result;
}

// Mutates info in-place so Winston's internal Symbol properties are preserved.
const scrubFormat = winston.format((info) => {
  const reserved = new Set(["level", "message", "timestamp", "splat"]);
  const record = info as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!reserved.has(key) && SCRUB_KEYS.has(normalizeKey(key))) {
      record[key] = "[REDACTED]";
    } else if (!reserved.has(key)) {
      record[key] = scrubValue(record[key]);
    }
  }
  return info;
});

export function enrichLogEntry(
  info: winston.Logform.TransformableInfo
): winston.Logform.TransformableInfo {
  const requestId = getRequestId();
  if (requestId && info.requestId === undefined) {
    info.requestId = requestId;
  }
  return info;
}

const requestContextFormat = winston.format((info) => enrichLogEntry(info));

const prettyFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  requestContextFormat(),
  scrubFormat(),
  winston.format.colorize({ all: true }),
  winston.format.printf((info) => {
    const { timestamp, level, message, ...meta } = info;
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : "";
    return `${timestamp} [${level}]: ${message} ${metaStr}`;
  })
);

const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  requestContextFormat(),
  scrubFormat(),
  winston.format.json()
);

const logFormat = process.env.LOG_FORMAT === "json" ? jsonFormat : prettyFormat;
const level = process.env.LOG_LEVEL || "info";

export const logger = winston.createLogger({
  level,
  levels: logLevels,
  format: logFormat,
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: "logs/error.log",
      level: "error",
    }),
    new winston.transports.File({
      filename: "logs/combined.log",
    }),
  ],
});

/**
 * Returns a child logger with requestId pre-bound to every log entry.
 * Use this in route handlers and middleware where req is available.
 */
export function getRequestLogger(requestId: string): winston.Logger {
  return logger.child({ requestId });
}
