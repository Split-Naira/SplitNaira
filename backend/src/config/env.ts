import { z } from "zod";
import { logger } from "../services/logger.js";

const stellarContractIdSchema = z
  .string()
  .min(1, "CONTRACT_ID must not be empty - deploy the Soroban contract first")
  .regex(/^C[A-Z2-7]{55}$/, "CONTRACT_ID must be a valid Stellar contract address");

const backendEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  PORT: z
    .string()
    .optional()
    .default("3001")
    .refine((val) => {
      const n = Number(val);
      return Number.isInteger(n) && n >= 1 && n <= 65535;
    }, "PORT must be a valid port number between 1 and 65535"),

  CORS_ORIGIN: z.string().optional(),
  LOG_LEVEL: z.string().optional().default("info"),
  LOG_FORMAT: z.enum(["json", "pretty"]).optional().default("pretty"),

  SENTRY_DSN: z.string().url("SENTRY_DSN must be a valid URL").optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_SCRUB_WALLET_ADDRESSES: z
    .enum(["true", "false"])
    .optional()
    .default("true"),

    LOG_SCRUB_WALLET_ADDRESSES: z
  .enum(["true", "false"])
  .optional()
  .default(process.env.NODE_ENV === "production" ? "true" : "false"),

  PAYMENTS_ADMIN_API_KEY: z.string().optional(),
  PAYMENTS_ADMIN_WRITE_ENABLED: z
    .enum(["true", "false"])
    .optional()
    .default("true"),

  STRICT_RESPONSE_VALIDATION: z
    .enum(["true", "false"])
    .optional()
    .default("false"),

  DATABASE_URL: z
    .string()
    .url("DATABASE_URL must be a valid PostgreSQL connection string"),

  HORIZON_URL: z
    .string()
    .min(1, "HORIZON_URL must not be empty")
    .url("HORIZON_URL must be a valid URL, e.g. https://horizon-testnet.stellar.org"),

  SOROBAN_RPC_URL: z
    .string()
    .min(1, "SOROBAN_RPC_URL must not be empty")
    .url("SOROBAN_RPC_URL must be a valid URL, e.g. https://soroban-testnet.stellar.org"),

  SOROBAN_NETWORK_PASSPHRASE: z
    .string()
    .min(1, "SOROBAN_NETWORK_PASSPHRASE must not be empty"),

  CONTRACT_ID: stellarContractIdSchema,

  SIMULATOR_ACCOUNT: z
    .string()
    .min(1, "SIMULATOR_ACCOUNT must not be empty"),

  RATE_LIMIT_WINDOW_MS: z.string().optional(),
  RATE_LIMIT_MAX: z.string().optional(),
  SHUTDOWN_FORCE_TIMEOUT_MS: z.string().optional(),

  READ_CACHE_TTL_MS: z
    .string()
    .optional()
    .refine(
      (val) => val === undefined || (Number.isInteger(Number(val)) && Number(val) > 0),
      "READ_CACHE_TTL_MS must be a positive integer",
    ),

  READ_CACHE_MAX_ENTRIES: z
    .string()
    .optional()
    .refine(
      (val) => val === undefined || (Number.isInteger(Number(val)) && Number(val) > 0),
      "READ_CACHE_MAX_ENTRIES must be a positive integer",
    ),

  DATABASE_POOL_MAX: z
    .string()
    .optional()
    .refine(
      (val) => val === undefined || (Number.isInteger(Number(val)) && Number(val) > 0),
      "DATABASE_POOL_MAX must be a positive integer",
    ),

  DATABASE_POOL_IDLE_MS: z
    .string()
    .optional()
    .refine(
      (val) => val === undefined || (Number.isInteger(Number(val)) && Number(val) > 0),
      "DATABASE_POOL_IDLE_MS must be a positive integer",
    ),

  DATABASE_POOL_CONN_TIMEOUT_MS: z
    .string()
    .optional()
    .refine(
      (val) => val === undefined || (Number.isInteger(Number(val)) && Number(val) > 0),
      "DATABASE_POOL_CONN_TIMEOUT_MS must be a positive integer",
    ),

  MAINNET_CONTRACT_ID: stellarContractIdSchema.optional(),

  RENDER_BACKEND_DEPLOY_HOOK_URL: z
    .string()
    .url("RENDER_BACKEND_DEPLOY_HOOK_URL must be a valid URL")
    .optional(),
}).superRefine((data, ctx) => {
  if (data.NODE_ENV === "production") {
    if (!data.CORS_ORIGIN || data.CORS_ORIGIN.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CORS_ORIGIN"],
        message:
          "CORS_ORIGIN is required in production. Set it to a comma-separated list of allowed frontend origins (e.g. https://app.splitnaira.com).",
      });
    } else {
      const origins = data.CORS_ORIGIN.split(",").map((o) => o.trim());
      if (origins.includes("*")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["CORS_ORIGIN"],
          message:
            "CORS_ORIGIN must not contain '*' in production. Specify explicit frontend origin(s).",
        });
      }
    }

    if (!data.PAYMENTS_ADMIN_API_KEY || data.PAYMENTS_ADMIN_API_KEY.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["PAYMENTS_ADMIN_API_KEY"],
        message:
          "PAYMENTS_ADMIN_API_KEY is required in production to protect /splits/admin wallet and payment operations.",
      });
    }
  }
});

export type BackendEnv = z.infer<typeof backendEnvSchema>;

export function validateEnv(): BackendEnv {
  const result = backendEnvSchema.safeParse(process.env);

  if (!result.success) {
    const lines = result.error.issues.map((issue) => {
      const key = issue.path.join(".") || "unknown";
      return `  x  ${key}: ${issue.message}`;
    });

    throw new Error(
      [
        "[env] Server cannot start - fix the following environment variable issues:",
        ...lines,
        "",
        "Copy backend/.env.example to backend/.env and fill in the missing values."
      ].join("\n")
    );
  }

  return result.data;
}

let cachedEnv: BackendEnv | null = null;

export function getEnv(): BackendEnv {
  if (!cachedEnv) {
    cachedEnv = validateEnv();
  }
  return cachedEnv;
}

export function clearEnvCache(): void {
  cachedEnv = null;
}

export interface EnvIssue {
  key: string;
  message: string;
}

export type EnvDiagnosticsResult =
  | { ok: true }
  | { ok: false; issues: EnvIssue[] };

export function getEnvDiagnostics(): EnvDiagnosticsResult {
  const result = backendEnvSchema.safeParse(process.env);

  if (result.success) {
    return { ok: true };
  }

  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      key: issue.path.join(".") || "unknown",
      message: issue.message
    }))
  };
}

export function printEnvDiagnostics(): void {
  const vars: Array<{ key: string; required: boolean }> = [
    { key: "NODE_ENV", required: false },
    { key: "PORT", required: false },
    { key: "CORS_ORIGIN", required: false },
    { key: "LOG_LEVEL", required: false },
    { key: "LOG_FORMAT", required: false },
    { key: "SENTRY_DSN", required: false },
    { key: "SENTRY_ENVIRONMENT", required: false },
    { key: "PAYMENTS_ADMIN_API_KEY", required: false },
    { key: "PAYMENTS_ADMIN_WRITE_ENABLED", required: false },
    { key: "STRICT_RESPONSE_VALIDATION", required: false },
    { key: "DATABASE_URL", required: true },
    { key: "HORIZON_URL", required: true },
    { key: "SOROBAN_RPC_URL", required: true },
    { key: "SOROBAN_NETWORK_PASSPHRASE", required: true },
    { key: "CONTRACT_ID", required: true },
    { key: "SIMULATOR_ACCOUNT", required: true },
    { key: "MAINNET_CONTRACT_ID", required: false },
    { key: "RENDER_BACKEND_DEPLOY_HOOK_URL", required: false },
    { key: "DATABASE_POOL_MAX", required: false },
    { key: "DATABASE_POOL_IDLE_MS", required: false },
    { key: "DATABASE_POOL_CONN_TIMEOUT_MS", required: false },
    { key: "READ_CACHE_TTL_MS", required: false },
    { key: "READ_CACHE_MAX_ENTRIES", required: false }
  ];

  logger.info("[env] Environment diagnostics:");

  for (const { key, required } of vars) {
    const raw = process.env[key];
    const present = raw !== undefined && raw.trim().length > 0;

    let marker: string;
    if (present) {
      marker = "ok";
    } else if (required) {
      marker = "MISSING";
    } else {
      marker = "(default)";
    }

    const display = present ? ` = ${truncate(raw)}` : "";
    logger.info(`  ${marker}  ${key}${display}`);
  }
}

function truncate(value: string, max = 48): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}
