import { z } from "zod";
import {
  OpenApiGeneratorV3,
  OpenAPIRegistry,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";
extendZodWithOpenApi(z);

import * as yaml from "yaml";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { logger } from "./services/logger.js";

import {
  createSplitSchema,
  lockProjectSchema,
  depositSchema,
  updateMetadataSchema,
  updateCollaboratorsSchema,
  listProjectsSchema,
  distributeSchema,
  historyQuerySchema,
  projectIdParamSchema,
  stellarAddressSchema,
  allowlistQuerySchema,
  adminTokenSchema,
  pauseDistributionsSchema,
  isTokenAllowedQuerySchema,
  unallocatedQuerySchema,
  withdrawUnallocatedSchema,
  claimSchema,
} from "./routes/splits.js";
import {
  userRegistrationSchema,
  userResponseSchema,
} from "./schemas/user.schemas.js";
import {
  transactionHistoryQuerySchema,
  transactionRecordSchema,
  transactionHistoryResponseSchema,
} from "./schemas/transactions.schemas.js";

const registry = new OpenAPIRegistry();

const ApiErrorSchema = registry.register(
  "ApiError",
  z.object({
    error: z.string().describe("Machine-readable error code"),
    message: z.string().optional().describe("Human-readable error message"),
    requestId: z.string().optional().describe("Request correlation ID"),
    details: z.record(z.string(), z.unknown()).optional().describe("Additional error context"),
  })
);

function apiErrorResponse(description: string) {
  return {
    description,
    content: {
      "application/json": {
        schema: ApiErrorSchema,
      },
    },
  };
}

function standardErrorResponses(options: {
  badRequest?: boolean;
  unauthorized?: boolean;
  notFound?: boolean;
  conflict?: boolean;
  serverError?: boolean;
  badGateway?: boolean;
  unavailable?: boolean;
} = {}) {
  const responses: Record<number, ReturnType<typeof apiErrorResponse>> = {};
  if (options.badRequest) responses[400] = apiErrorResponse("Validation error");
  if (options.unauthorized) responses[401] = apiErrorResponse("Authentication required");
  if (options.notFound) responses[404] = apiErrorResponse("Resource not found");
  if (options.conflict) responses[409] = apiErrorResponse("Conflict with existing resource");
  if (options.serverError) responses[500] = apiErrorResponse("Internal server error");
  if (options.badGateway) responses[502] = apiErrorResponse("Upstream RPC or contract error");
  if (options.unavailable) responses[503] = apiErrorResponse("Service temporarily unavailable");
  return responses;
}

// ─── Components ───────────────────────────────────────────────────────────────

// SplitNaira is in active development. This repo currently contains:

// - `contracts/` Soroban smart contract and tests
// - `frontend/` Next.js + Tailwind scaffold
// - `backend/` Express API scaffold
// - `demo/` Static HTML flow prototype

const ProjectSchema = registry.register(
  "Project",
  z.object({
    projectId: z.string(),
    title: z.string(),
    projectType: z.string(),
    owner: z.string(),
    token: z.string(),
    balance: z.string(),
    totalDistributed: z.string(),
    locked: z.boolean(),
    collaborators: z.array(
      z.object({
        address: z.string(),
        alias: z.string(),
        basisPoints: z.number(),
      })
    ),
  })
);

const XdrResponseSchema = registry.register(
  "XdrResponse",
  z.object({
    xdr: z.string(),
    metadata: z.object({
      contractId: z.string(),
      networkPassphrase: z.string(),
      sourceAccount: z.string(),
      operation: z.string(),
    }),
  })
);

// ─── Routes ───────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/splits",
  summary: "List all split projects",
  description: "Returns a paginated list of on-chain split projects with optional search and type filters.",
  tags: ["Splits"],
  request: {
    query: listProjectsSchema,
  },
  responses: {
    200: {
      description: "List of projects",
      content: {
        "application/json": {
          schema: z.array(ProjectSchema),
        },
      },
    },
    ...standardErrorResponses({ badRequest: true, badGateway: true, serverError: true }),
  },
});

registry.registerPath({
  method: "post",
  path: "/splits",
  summary: "Create a new split project",
  description: "Builds an unsigned Soroban transaction XDR to create a new revenue-split project on-chain.",
  tags: ["Splits"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: createSplitSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Unsigned transaction XDR",
      content: {
        "application/json": {
          schema: XdrResponseSchema,
        },
      },
    },
    ...standardErrorResponses({ badRequest: true, badGateway: true, serverError: true }),
  },
});

registry.registerPath({
  method: "get",
  path: "/splits/{projectId}",
  summary: "Get project details by ID",
  description: "Fetches the current on-chain state for a single split project including collaborators and balances.",
  tags: ["Splits"],
  request: {
    params: z.object({ projectId: projectIdParamSchema }),
  },
  responses: {
    200: {
      description: "Project details",
      content: {
        "application/json": {
          schema: ProjectSchema,
        },
      },
    },
    ...standardErrorResponses({ badRequest: true, notFound: true, badGateway: true, serverError: true }),
  },
});

registry.registerPath({
  method: "post",
  path: "/splits/{projectId}/lock",
  summary: "Lock a project permanently",
  description: "Builds an unsigned XDR to permanently lock a project, preventing further metadata or collaborator changes.",
  tags: ["Splits"],
  request: {
    params: z.object({ projectId: projectIdParamSchema }),
    body: {
      content: {
        "application/json": {
          schema: lockProjectSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Unsigned transaction XDR",
      content: {
        "application/json": {
          schema: XdrResponseSchema,
        },
      },
    },
    ...standardErrorResponses({ badRequest: true, notFound: true, badGateway: true, serverError: true }),
  },
});

registry.registerPath({
  method: "post",
  path: "/splits/{projectId}/deposit",
  summary: "Deposit funds into a project",
  description: "Builds an unsigned XDR to deposit tokens into a split project's escrow balance.",
  tags: ["Splits"],
  request: {
    params: z.object({ projectId: projectIdParamSchema }),
    body: {
      content: {
        "application/json": {
          schema: depositSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Unsigned transaction XDR",
      content: {
        "application/json": {
          schema: XdrResponseSchema,
        },
      },
    },
    ...standardErrorResponses({ badRequest: true, notFound: true, badGateway: true, serverError: true }),
  },
});

registry.registerPath({
  method: "patch",
  path: "/splits/{projectId}/metadata",
  summary: "Update project metadata (title/category)",
  description: "Builds an unsigned XDR to update a project's title and project type. Text fields are server-side sanitized.",
  tags: ["Splits"],
  request: {
    params: z.object({ projectId: projectIdParamSchema }),
    body: {
      content: {
        "application/json": {
          schema: updateMetadataSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Unsigned transaction XDR",
      content: {
        "application/json": {
          schema: XdrResponseSchema,
        },
      },
    },
    ...standardErrorResponses({ badRequest: true, notFound: true, badGateway: true, serverError: true }),
  },
});

registry.registerPath({
  method: "put",
  path: "/splits/{projectId}/collaborators",
  summary: "Update project collaborators",
  description: "Builds an unsigned XDR to replace the collaborator list and revenue share allocations.",
  tags: ["Splits"],
  request: {
    params: z.object({ projectId: projectIdParamSchema }),
    body: {
      content: {
        "application/json": {
          schema: updateCollaboratorsSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Unsigned transaction XDR",
      content: {
        "application/json": {
          schema: XdrResponseSchema,
        },
      },
    },
    ...standardErrorResponses({ badRequest: true, notFound: true, badGateway: true, serverError: true }),
  },
});

registry.registerPath({
  method: "post",
  path: "/splits/{projectId}/distribute",
  summary: "Distribute project funds to collaborators",
  description: "Builds an unsigned XDR to distribute accumulated project funds according to collaborator shares.",
  tags: ["Splits"],
  request: {
    params: z.object({ projectId: projectIdParamSchema }),
    body: {
      content: {
        "application/json": {
          schema: distributeSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Unsigned transaction XDR",
      content: {
        "application/json": {
          schema: XdrResponseSchema,
        },
      },
    },
    ...standardErrorResponses({ badRequest: true, notFound: true, badGateway: true, serverError: true }),
  },
});

const ClaimableResponseSchema = registry.register(
  "ClaimableResponse",
  z.object({
    projectId: z.string().describe("The project ID"),
    collaborator: z.string().describe("Stellar address of the collaborator"),
    claimable: z.string().describe("Amount available to claim, in stroops"),
    claimed: z.string().describe("Amount already claimed, in stroops"),
    total: z.string().describe("Total allocated (claimed + claimable), in stroops"),
  })
);

registry.registerPath({
  method: "get",
  path: "/splits/{projectId}/claimable/{collaborator}",
  summary: "Get claimable payout information for a collaborator",
  description: "Returns the claimable, claimed, and total allocated amounts for a collaborator on a project.",
  tags: ["Splits"],
  request: {
    params: z.object({
      projectId: projectIdParamSchema,
      collaborator: stellarAddressSchema.describe("Stellar address of the collaborator"),
    }),
  },
  responses: {
    200: {
      description: "Claimable payout information",
      content: {
        "application/json": {
          schema: ClaimableResponseSchema,
        },
      },
    },
    ...standardErrorResponses({ badRequest: true, notFound: true, badGateway: true, serverError: true }),
  },
});

registry.registerPath({
  method: "post",
  path: "/splits/{projectId}/claim",
  summary: "Claim collaborator payout",
  description: "Builds an unsigned XDR allowing a collaborator to claim their allocated share from a project.",
  tags: ["Splits"],
  request: {
    params: z.object({ projectId: projectIdParamSchema }),
    body: {
      content: {
        "application/json": {
          schema: claimSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Unsigned transaction XDR",
      content: {
        "application/json": {
          schema: XdrResponseSchema,
        },
      },
    },
    ...standardErrorResponses({ badRequest: true, notFound: true, badGateway: true, serverError: true }),
  },
});

registry.registerPath({
  method: "get",
  path: "/splits/{projectId}/history",
  summary: "Get project transaction history",
  description: "Returns paginated on-chain distribution and payment events for a project.",
  tags: ["Splits"],
  request: {
    params: z.object({ projectId: projectIdParamSchema }),
    query: historyQuerySchema,
  },
  responses: {
    200: {
      description: "History items",
      content: {
        "application/json": {
          schema: z.object({
            items: z.array(z.any()),
            nextCursor: z.string().nullable(),
          }),
        },
      },
    },
    ...standardErrorResponses({ badRequest: true, notFound: true, badGateway: true, serverError: true }),
  },
});

// ─── Admin Endpoints ──────────────────────────────────────────────────────────

const AdminStatusSchema = registry.register(
  "AdminStatus",
  z.object({
    admin: z.string().nullable(),
    isPaused: z.boolean(),
  })
);

registry.registerPath({
  method: "get",
  path: "/splits/admin/allowlist",
  summary: "List allowed payment tokens",
  description: "Returns the contract admin address, total allowed token count, and a paginated token allowlist.",
  tags: ["Admin"],
  request: { query: allowlistQuerySchema },
  responses: {
    200: {
      description: "Token allowlist page",
      content: {
        "application/json": {
          schema: z.object({
            admin: z.string().nullable(),
            count: z.number().int(),
            tokens: z.array(z.string()),
          }),
        },
      },
    },
    ...standardErrorResponses({ badRequest: true, unauthorized: true, badGateway: true, serverError: true }),
  },
});

registry.registerPath({
  method: "post",
  path: "/splits/admin/allow-token",
  summary: "Allow a payment token",
  description: "Builds an unsigned XDR to add a token to the contract allowlist. Requires admin API key.",
  tags: ["Admin"],
  request: {
    body: { content: { "application/json": { schema: adminTokenSchema } } },
  },
  responses: {
    200: { description: "Unsigned transaction XDR", content: { "application/json": { schema: XdrResponseSchema } } },
    ...standardErrorResponses({ badRequest: true, unauthorized: true, unavailable: true, badGateway: true, serverError: true }),
  },
});

registry.registerPath({
  method: "post",
  path: "/splits/admin/disallow-token",
  summary: "Disallow a payment token",
  description: "Builds an unsigned XDR to remove a token from the contract allowlist. Requires admin API key.",
  tags: ["Admin"],
  request: {
    body: { content: { "application/json": { schema: adminTokenSchema } } },
  },
  responses: {
    200: { description: "Unsigned transaction XDR", content: { "application/json": { schema: XdrResponseSchema } } },
    ...standardErrorResponses({ badRequest: true, unauthorized: true, unavailable: true, badGateway: true, serverError: true }),
  },
});

registry.registerPath({
  method: "post",
  path: "/splits/admin/pause-distributions",
  summary: "Pause all distributions",
  description: "Builds an unsigned XDR to pause contract-wide fund distributions. Requires admin API key.",
  tags: ["Admin"],
  request: {
    body: { content: { "application/json": { schema: pauseDistributionsSchema } } },
  },
  responses: {
    200: { description: "Unsigned transaction XDR", content: { "application/json": { schema: XdrResponseSchema } } },
    ...standardErrorResponses({ badRequest: true, unauthorized: true, unavailable: true, badGateway: true, serverError: true }),
  },
});

registry.registerPath({
  method: "post",
  path: "/splits/admin/unpause-distributions",
  summary: "Unpause distributions",
  description: "Builds an unsigned XDR to resume contract-wide fund distributions. Requires admin API key.",
  tags: ["Admin"],
  request: {
    body: { content: { "application/json": { schema: pauseDistributionsSchema } } },
  },
  responses: {
    200: { description: "Unsigned transaction XDR", content: { "application/json": { schema: XdrResponseSchema } } },
    ...standardErrorResponses({ badRequest: true, unauthorized: true, unavailable: true, badGateway: true, serverError: true }),
  },
});

registry.registerPath({
  method: "get",
  path: "/splits/admin/status",
  summary: "Get admin contract status",
  description: "Returns the current contract admin address and whether distributions are paused.",
  tags: ["Admin"],
  responses: {
    200: {
      description: "Admin status",
      content: { "application/json": { schema: AdminStatusSchema } },
    },
    ...standardErrorResponses({ unauthorized: true, badGateway: true, serverError: true }),
  },
});

registry.registerPath({
  method: "get",
  path: "/splits/admin/is-token-allowed",
  summary: "Check if a token is allowed",
  description: "Returns whether a specific token contract address is on the allowlist.",
  tags: ["Admin"],
  request: { query: isTokenAllowedQuerySchema },
  responses: {
    200: {
      description: "Token allowlist check result",
      content: {
        "application/json": {
          schema: z.object({ token: z.string(), isAllowed: z.boolean() }),
        },
      },
    },
    ...standardErrorResponses({ badRequest: true, unauthorized: true, badGateway: true, serverError: true }),
  },
});

registry.registerPath({
  method: "get",
  path: "/splits/admin/token-count",
  summary: "Get allowed token count",
  description: "Returns the total number of tokens on the contract allowlist.",
  tags: ["Admin"],
  responses: {
    200: {
      description: "Allowed token count",
      content: {
        "application/json": {
          schema: z.object({ count: z.number().int() }),
        },
      },
    },
    ...standardErrorResponses({ unauthorized: true, badGateway: true, serverError: true }),
  },
});

registry.registerPath({
  method: "get",
  path: "/splits/admin/unallocated",
  summary: "Get unallocated token balance",
  description: "Returns the unallocated balance held by the contract for a given token.",
  tags: ["Admin"],
  request: { query: unallocatedQuerySchema },
  responses: {
    200: {
      description: "Unallocated balance",
      content: {
        "application/json": {
          schema: z.object({ token: z.string(), unallocated: z.string() }),
        },
      },
    },
    ...standardErrorResponses({ badRequest: true, unauthorized: true, badGateway: true, serverError: true }),
  },
});

registry.registerPath({
  method: "post",
  path: "/splits/admin/withdraw-unallocated",
  summary: "Withdraw unallocated tokens",
  description: "Builds an unsigned XDR to recover unallocated token balance from the contract. Requires admin API key.",
  tags: ["Admin"],
  request: {
    body: { content: { "application/json": { schema: withdrawUnallocatedSchema } } },
  },
  responses: {
    200: { description: "Unsigned transaction XDR", content: { "application/json": { schema: XdrResponseSchema } } },
    ...standardErrorResponses({ badRequest: true, unauthorized: true, unavailable: true, badGateway: true, serverError: true }),
  },
});

registry.registerPath({
  method: "get",
  path: "/splits/admin/cache-stats",
  summary: "Get read cache statistics",
  description: "Returns internal read-cache hit/miss statistics for diagnostics.",
  tags: ["Admin"],
  responses: {
    200: {
      description: "Cache statistics",
      content: {
        "application/json": {
          schema: z.object({
            hits: z.number().int(),
            misses: z.number().int(),
            evictions: z.number().int(),
            ttlMs: z.number().int(),
          }),
        },
      },
    },
    ...standardErrorResponses({ unauthorized: true, serverError: true }),
  },
});

// ─── User Endpoints ───────────────────────────────────────────────────────────

registry.registerPath({
  method: "post",
  path: "/users/register",
  summary: "Register a new user",
  description: "Creates a user profile linked to a Stellar wallet address.",
  tags: ["Users"],
  request: {
    body: { content: { "application/json": { schema: userRegistrationSchema } } },
  },
  responses: {
    201: {
      description: "Registered user profile",
      content: { "application/json": { schema: userResponseSchema } },
    },
    ...standardErrorResponses({ badRequest: true, conflict: true, serverError: true }),
  },
});

registry.registerPath({
  method: "post",
  path: "/users/login",
  summary: "Log in by wallet address",
  description: "Authenticates a registered user and returns a JWT bearer token.",
  tags: ["Users"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ walletAddress: stellarAddressSchema }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Authenticated user with JWT",
      content: {
        "application/json": {
          schema: userResponseSchema.extend({ token: z.string() }),
        },
      },
    },
    ...standardErrorResponses({ badRequest: true, notFound: true, serverError: true }),
  },
});

registry.registerPath({
  method: "get",
  path: "/users/me",
  summary: "Get authenticated user profile",
  description: "Returns the profile of the user identified by the JWT bearer token.",
  tags: ["Users"],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "Authenticated user profile",
      content: { "application/json": { schema: userResponseSchema } },
    },
    ...standardErrorResponses({ unauthorized: true, notFound: true, serverError: true }),
  },
});

registry.registerPath({
  method: "patch",
  path: "/users/me",
  summary: "Update authenticated user profile",
  description: "Updates email or alias for the authenticated user.",
  tags: ["Users"],
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            email: z.string().email().optional(),
            alias: z.string().min(1).max(64).optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Updated user profile",
      content: { "application/json": { schema: userResponseSchema } },
    },
    ...standardErrorResponses({ badRequest: true, unauthorized: true, notFound: true, serverError: true }),
  },
});

registry.registerPath({
  method: "get",
  path: "/users/{walletAddress}",
  summary: "Get user by wallet address",
  description: "Looks up a public user profile by Stellar wallet address.",
  tags: ["Users"],
  request: {
    params: z.object({ walletAddress: stellarAddressSchema }),
  },
  responses: {
    200: {
      description: "User profile",
      content: { "application/json": { schema: userResponseSchema } },
    },
    ...standardErrorResponses({ badRequest: true, notFound: true, serverError: true }),
  },
});

// ─── Transaction Endpoints ────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/transactions/history",
  summary: "Query payout transaction history",
  description: "Returns paginated payout records with optional wallet, date, and status filters.",
  tags: ["Transactions"],
  request: { query: transactionHistoryQuerySchema },
  responses: {
    200: {
      description: "Paginated transaction history",
      content: { "application/json": { schema: transactionHistoryResponseSchema } },
    },
    ...standardErrorResponses({ badRequest: true, serverError: true }),
  },
});

registry.registerPath({
  method: "get",
  path: "/transactions/{txHash}",
  summary: "Get transaction by hash",
  description: "Returns a single payout record matching the Stellar transaction hash.",
  tags: ["Transactions"],
  request: {
    params: z.object({ txHash: z.string().min(1) }),
  },
  responses: {
    200: {
      description: "Transaction record",
      content: { "application/json": { schema: transactionRecordSchema } },
    },
    ...standardErrorResponses({ badRequest: true, notFound: true, serverError: true }),
  },
});

registry.registerPath({
  method: "get",
  path: "/transactions/recipient/{walletAddress}",
  summary: "List transactions for a recipient",
  description: "Returns all payout records sent to the given Stellar wallet address.",
  tags: ["Transactions"],
  request: {
    params: z.object({ walletAddress: z.string().regex(/^G[A-Z2-7]{55}$/) }),
  },
  responses: {
    200: {
      description: "Recipient transaction list",
      content: {
        "application/json": {
          schema: z.object({
            transactions: z.array(transactionRecordSchema),
            total: z.number().int(),
            walletAddress: z.string(),
          }),
        },
      },
    },
    ...standardErrorResponses({ badRequest: true, serverError: true }),
  },
});

// ─── Health Endpoints ─────────────────────────────────────────────────────────

const HealthResponseSchema = registry.register(
  "HealthResponse",
  z.object({
    status: z.enum(["ok", "not_ready"]),
    uptime: z.number().optional().describe("Server uptime in seconds"),
    timestamp: z.string().optional().describe("ISO 8601 timestamp"),
  })
);

const ReadinessResponseSchema = registry.register(
  "ReadinessResponse",
  z.object({
    status: z.enum(["ready", "not_ready"]),
    error: z.string().optional().describe("Error code if not ready"),
    message: z.string().optional().describe("Error message if not ready"),
    issues: z.array(z.string()).optional().describe("List of configuration issues"),
    requestId: z.string().optional().describe("Request ID for tracing"),
  })
);

registry.registerPath({
  method: "get",
  path: "/health",
  summary: "Get readiness status (alias for /health/ready)",
  tags: ["Health"],
  responses: {
    200: {
      description: "Server is ready to accept traffic",
      content: {
        "application/json": {
          schema: ReadinessResponseSchema,
        },
      },
    },
    503: {
      description: "Server is not ready",
      content: {
        "application/json": {
          schema: ReadinessResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/health/live",
  summary: "Liveness check (Kubernetes compatible)",
  tags: ["Health"],
  responses: {
    200: {
      description: "Server is alive",
      content: {
        "application/json": {
          schema: z.object({
            status: z.literal("ok"),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/health/ready",
  summary: "Readiness check (Kubernetes compatible)",
  tags: ["Health"],
  responses: {
    200: {
      description: "Server is ready to accept traffic",
      content: {
        "application/json": {
          schema: z.object({
            status: z.literal("ready"),
          }),
        },
      },
    },
    503: {
      description: "Server is not ready (missing configuration)",
      content: {
        "application/json": {
          schema: ReadinessResponseSchema,
        },
      },
    },
  },
});

const MainnetReadinessResponseSchema = registry.register(
  "MainnetReadinessResponse",
  z.object({
    status: z.enum(["ready", "not_ready"]),
    requestId: z.string().optional(),
    error: z.string().optional(),
    message: z.string().optional(),
    details: z.record(z.any()).optional(),
    components: z.object({
      env: z.object({
        ok: z.boolean(),
        message: z.string().optional(),
        details: z.record(z.any()).optional()
      }),
      db: z.object({
        ok: z.boolean(),
        message: z.string().optional(),
        details: z.record(z.any()).optional()
      }),
      cache: z.object({
        ok: z.boolean(),
        message: z.string().optional(),
        details: z.record(z.any()).optional()
      }),
      deploy: z.object({
        ok: z.boolean(),
        message: z.string().optional(),
        productionSecrets: z.object({
          mainnetContractId: z.boolean(),
          renderBackendDeployHookUrl: z.boolean()
        }).optional(),
        contractIdMatch: z.boolean().optional(),
        databasePoolMax: z.number().optional(),
        readCacheTtlMs: z.number().optional(),
        readCacheMaxEntries: z.number().optional(),
      })
    })
  })
);

registry.registerPath({
  method: "get",
  path: "/ops/mainnet-readiness",
  summary: "Mainnet readiness validation for deployment and ops workflows",
  tags: ["Operations"],
  responses: {
    200: {
      description: "Mainnet readiness validation passed",
      content: {
        "application/json": {
          schema: MainnetReadinessResponseSchema,
        },
      },
    },
    503: {
      description: "Mainnet readiness validation failed",
      content: {
        "application/json": {
          schema: MainnetReadinessResponseSchema,
        },
      },
    },
  },
});

// ─── Root Endpoint ────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/",
  summary: "Get API information",
  tags: ["System"],
  responses: {
    200: {
      description: "API metadata",
      content: {
        "application/json": {
          schema: z.object({
            name: z.string(),
            status: z.string(),
            version: z.string(),
          }),
        },
      },
    },
  },
});

// ─── Generation ───────────────────────────────────────────────────────────────

export function generateOpenApi() {
  const generator = new OpenApiGeneratorV3(registry.definitions);

  return generator.generateDocument({
    openapi: "3.0.0",
    info: {
      version: "0.1.0",
      title: "SplitNaira API",
      description: "Premium royalty management API on Stellar network.",
    },
    servers: [{ url: "http://localhost:3001" }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "JWT obtained from POST /users/login",
        },
        adminApiKey: {
          type: "apiKey",
          in: "header",
          name: "x-admin-api-key",
          description: "Payments admin API key for /splits/admin mutation endpoints",
        },
      },
    },
  });
}

// Check if this file is being run directly
const __filename = fileURLToPath(import.meta.url);
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith("openapi.ts") ||
  process.argv[1].endsWith("openapi.js") ||
  process.argv[1] === __filename
);

if (isDirectRun) {
  const spec = generateOpenApi();
  const docsDir = path.join(process.cwd(), "openapi");
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(docsDir, "openapi.yaml"),
    yaml.stringify(spec)
  );
  logger.info("OpenAPI spec generated at docs/openapi.yaml");
}
