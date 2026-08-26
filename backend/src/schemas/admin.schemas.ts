import { z } from "zod";

/**
 * Zod schemas for Admin and Ops endpoint response validation.
 *
 * These schemas prevent response schema drift across administrative endpoints,
 * ensuring incident response tools, admin consoles, and monitoring dashboards
 * receive predictable payload shapes.
 */

// ── Admin Read Routes ─────────────────────────────────────────────────────────

export const AdminStatusResponseSchema = z.object({
  admin: z.string().nullable().describe("Current contract admin Stellar address or null"),
  isPaused: z.boolean().describe("Whether contract distributions are globally paused"),
});

export type AdminStatusResponse = z.infer<typeof AdminStatusResponseSchema>;

export const AdminIsTokenAllowedResponseSchema = z.object({
  token: z.string().describe("Token contract address checked"),
  isAllowed: z.boolean().describe("Whether token is allowlisted"),
});

export type AdminIsTokenAllowedResponse = z.infer<typeof AdminIsTokenAllowedResponseSchema>;

export const AdminTokenCountResponseSchema = z.object({
  count: z.number().int().nonnegative().describe("Number of allowlisted tokens"),
});

export type AdminTokenCountResponse = z.infer<typeof AdminTokenCountResponseSchema>;

export const AdminUnallocatedResponseSchema = z.object({
  token: z.string().describe("Token contract address"),
  unallocated: z.string().describe("Recoverable unallocated stroops as string"),
});

export type AdminUnallocatedResponse = z.infer<typeof AdminUnallocatedResponseSchema>;

export const AdminCacheStatsResponseSchema = z.object({
  size: z.number().int().nonnegative().describe("Number of active cached entries"),
  keys: z.array(z.string()).describe("Cached key prefixes or names"),
  hits: z.number().int().nonnegative().optional().describe("Cache hit count"),
  misses: z.number().int().nonnegative().optional().describe("Cache miss count"),
  hitRate: z.number().optional().describe("Cache hit ratio"),
  ttlMs: z.number().int().nonnegative().describe("Configured cache TTL in milliseconds"),
});

export type AdminCacheStatsResponse = z.infer<typeof AdminCacheStatsResponseSchema>;

// ── Admin Mutation Routes (Unsigned XDR + Audit Context) ─────────────────────

export const AdminAuditContextSchema = z.object({
  token: z.string().optional(),
  destination: z.string().optional(),
  amount: z.number().optional(),
  admin: z.string().optional(),
  initiatedAt: z.string().optional(),
}).passthrough();

export const AdminUnsignedXdrMetadataSchema = z.object({
  contractId: z.string().describe("Deployed contract ID"),
  networkPassphrase: z.string().describe("Stellar network passphrase"),
  sourceAccount: z.string().describe("Admin source account address"),
  sequenceNumber: z.string().optional().describe("Account sequence number"),
  fee: z.string().optional().describe("Transaction fee in stroops"),
  operation: z.string().describe("Invoked contract method name"),
  auditContext: AdminAuditContextSchema.optional().describe("Audit logging context metadata"),
}).passthrough();

export const AdminUnsignedXdrResponseSchema = z.object({
  xdr: z.string().min(1).describe("Base64 encoded unsigned transaction envelope"),
  metadata: AdminUnsignedXdrMetadataSchema.describe("Transaction metadata and audit context"),
});

export type AdminUnsignedXdrResponse = z.infer<typeof AdminUnsignedXdrResponseSchema>;

// ── Ops Routes ────────────────────────────────────────────────────────────────

export const OpsStatusResponseSchema = z.object({
  eventListener: z.object({
    status: z.string().describe("EventListener lifecycle status"),
    lastSuccessfulPoll: z.string().nullable().optional().describe("ISO timestamp of last successful poll"),
    consecutiveErrors: z.number().int().optional().describe("Count of consecutive poll failures"),
    ledgerLag: z.number().optional().describe("Lag behind latest ledger"),
  }).passthrough(),
  database: z.object({
    connected: z.boolean().describe("Whether TypeORM database data-source is initialized"),
  }),
});

export type OpsStatusResponse = z.infer<typeof OpsStatusResponseSchema>;

export const OpsBackfillResponseSchema = z.object({
  success: z.boolean().describe("Whether backfill operation completed"),
  message: z.string().optional().describe("Human-readable status message"),
  error: z.string().optional().describe("Error details if backfill failed"),
});

export type OpsBackfillResponse = z.infer<typeof OpsBackfillResponseSchema>;

export const ReadinessComponentSchema = z.object({
  ok: z.boolean().describe("Component readiness status"),
  message: z.string().optional().describe("Status code or reason"),
  details: z.record(z.string(), z.unknown()).optional().describe("Diagnostic details"),
});

export const MainnetReadinessResponseSchema = z.object({
  status: z.enum(["ready", "not_ready"]).describe("Overall readiness status"),
  requestId: z.string().optional().describe("Correlation request ID"),
  error: z.string().optional().describe("Error identifier if not ready"),
  message: z.string().optional().describe("Human-readable readiness message"),
  details: z.record(z.string(), z.unknown()).optional(),
  components: z.object({
    env: ReadinessComponentSchema,
    db: ReadinessComponentSchema,
    cache: ReadinessComponentSchema,
    deploy: ReadinessComponentSchema.extend({
      productionSecrets: z.object({
        mainnetContractId: z.boolean(),
        renderBackendDeployHookUrl: z.boolean(),
      }).optional(),
      contractIdMatch: z.boolean().optional(),
      databasePoolMax: z.number().optional(),
      readCacheTtlMs: z.number().optional(),
      readCacheMaxEntries: z.number().optional(),
    }),
  }),
});

export type MainnetReadinessResponse = z.infer<typeof MainnetReadinessResponseSchema>;
