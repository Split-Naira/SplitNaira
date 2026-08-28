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

// ─── Example fixtures ──────────────────────────────────────────────────────────
//
// Realistic (but non-custodial) Stellar addresses used across request/response
// examples below. Keep the shapes here aligned with the fixtures used in
// backend/src/__tests__/e2e-happy-path.test.ts and events*.test.ts so the docs
// don't drift from what the test suite actually exercises.

const EXAMPLE_OWNER = "GBJRKIYXAAFD3NZCWJXGUTNKYUQFZC2ANS6LRMBPJCE4IZSMJJMZPQBT";
const EXAMPLE_COLLAB_A = "GCZTK3PNYXCVF7Z3ELVELEJZ7BVGPGPVJ3NVZNI7O6DVCHPA4JU6LXRV";
const EXAMPLE_COLLAB_B = "GBG234UA6RBPDD5K6FHMQXHUXB5ALOENQGH24Y3W4ERX2YJNQ4MK4V25";
const EXAMPLE_TOKEN = "CDOVDY3MZDG7PHCGVP7EP2EKQ2ENV26DZW6FKLBRN42LOGIZGXZV3WX5";
const EXAMPLE_CONTRACT_ID = "CAGR5U5IBEPFVJDZPZUXXNCPXAHNZ6TWVIUTI5RLRH3SZSU4O2VXDOPF";
const EXAMPLE_PROJECT_ID = "afrobeats_001";
const EXAMPLE_TX_HASH = "3389e9f0f1a65f19736cacf544c2e825313e8447f569233bb8db39aa607c8fc";
const EXAMPLE_REQUEST_ID = "b6f1a2d4-8c3e-4a1b-9f2e-6d5c7a8b9c0d";

// Mirrors projectIdParamSchema's constraints (see schemas/splits.ts). Built
// locally rather than calling `.openapi()` on the imported schema directly:
// ESM hoists that import ahead of the `extendZodWithOpenApi(z)` call above,
// so the imported instance never picks up the `.openapi()` prototype method.
const exampleProjectIdParam = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-zA-Z0-9_]+$/)
  .openapi({ example: EXAMPLE_PROJECT_ID, description: "Project ID" });

function xdrExample(operation: string) {
  return {
    xdr: "AAAAAgAAAAC5tRUXpDqRcTvpvKF...(truncated unsigned transaction envelope)",
    metadata: {
      contractId: EXAMPLE_CONTRACT_ID,
      networkPassphrase: "Test SDF Network ; September 2015",
      sourceAccount: EXAMPLE_OWNER,
      operation,
    },
  };
}

const ApiErrorSchema = registry.register(
  "ApiError",
  z
    .object({
      error: z.string().describe("Machine-readable error code"),
      message: z.string().optional().describe("Human-readable error message"),
      requestId: z.string().optional().describe("Request correlation ID"),
      details: z.record(z.string(), z.unknown()).optional().describe("Additional error context"),
    })
    .openapi({
      example: {
        error: "VALIDATION_ERROR",
        message: "collaborators basisPoints must sum to exactly 10000",
        requestId: EXAMPLE_REQUEST_ID,
        details: { path: ["collaborators"] },
      },
    })
);

function apiErrorResponse(description: string, example?: Record<string, unknown>) {
  return {
    description,
    content: {
      "application/json": {
        schema: ApiErrorSchema,
        ...(example ? { example } : {}),
      },
    },
  };
}

function standardErrorResponses(options: {
  badRequest?: boolean;
  badRequestExample?: Record<string, unknown>;
  unauthorized?: boolean;
  forbidden?: boolean;
  notFound?: boolean;
  conflict?: boolean;
  conflictExample?: Record<string, unknown>;
  rateLimited?: boolean;
  serverError?: boolean;
  serverErrorExample?: Record<string, unknown>;
  badGateway?: boolean;
  badGatewayExample?: Record<string, unknown>;
  unavailable?: boolean;
} = {}) {
  const responses: Record<number, ReturnType<typeof apiErrorResponse>> = {};
  if (options.badRequest) {
    responses[400] = apiErrorResponse("Validation error", options.badRequestExample);
  }
  if (options.unauthorized) {
    responses[401] = apiErrorResponse("Authentication required", {
      error: "UNAUTHORIZED",
      message: "Missing or invalid bearer token / admin API key.",
      requestId: EXAMPLE_REQUEST_ID,
    });
  }
  if (options.forbidden) {
    responses[403] = apiErrorResponse("Access denied", {
      error: "FORBIDDEN",
      message: "You do not have permission to perform this action.",
      requestId: EXAMPLE_REQUEST_ID,
    });
  }
  if (options.notFound) {
    responses[404] = apiErrorResponse("Resource not found", {
      error: "NOT_FOUND",
      message: `Project ${EXAMPLE_PROJECT_ID} does not exist.`,
      requestId: EXAMPLE_REQUEST_ID,
    });
  }
  if (options.conflict) {
    responses[409] = apiErrorResponse("Conflict with existing resource", options.conflictExample ?? {
      error: "CONFLICT",
      message: `A project with ID "${EXAMPLE_PROJECT_ID}" already exists.`,
      requestId: EXAMPLE_REQUEST_ID,
    });
  }
  if (options.rateLimited) {
    responses[429] = apiErrorResponse("Too many requests", {
      error: "RATE_LIMIT_EXCEEDED",
      message: "Too many requests. Please retry after the rate limit window.",
      requestId: EXAMPLE_REQUEST_ID,
    });
  }
  if (options.serverError) {
    responses[500] = apiErrorResponse("Internal server error", options.serverErrorExample ?? {
      error: "INTERNAL_ERROR",
      message: "An unexpected error occurred. Please try again later.",
      requestId: EXAMPLE_REQUEST_ID,
    });
  }
  if (options.badGateway) {
    responses[502] = apiErrorResponse("Upstream RPC or contract error", options.badGatewayExample ?? {
      error: "BAD_GATEWAY",
      message: "The Stellar network RPC call failed. Please retry.",
      requestId: EXAMPLE_REQUEST_ID,
    });
  }
  if (options.unavailable) {
    responses[503] = apiErrorResponse("Service temporarily unavailable", {
      error: "SERVICE_UNAVAILABLE",
      message: "The service is temporarily unavailable. Please try again shortly.",
      requestId: EXAMPLE_REQUEST_ID,
    });
  }
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

const idempotencyKeyHeaderSchema = z.object({
  "Idempotency-Key": z
    .string()
    .min(1)
    .max(255)
    .regex(/^[A-Za-z0-9_.:-]+$/)
    .optional()
    .openapi({
      example: "550e8400-e29b-41d4-a716-446655440000",
      description:
        "Client-generated unique token identifying this create-split request (Issue #888). " +
        "Replaying the same key with an identical payload returns the original response " +
        "instead of resubmitting; replaying it with a different payload returns 409 " +
        "IDEMPOTENCY_KEY_CONFLICT. Keys expire after IDEMPOTENCY_KEY_TTL_MS (default 24h), " +
        "after which the request is treated as new.",
    }),
});

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
    ...standardErrorResponses({ badRequest: true, rateLimited: true, badGateway: true, serverError: true }),
  },
});

registry.registerPath({
  method: "post",
  path: "/splits",
  summary: "Create a new split project",
  description:
    "Builds an unsigned Soroban transaction XDR to create a new revenue-split project on-chain. " +
    "The caller must sign the returned XDR with the `owner` wallet and submit it themselves; " +
    "this endpoint never holds a private key. Supports an optional `Idempotency-Key` header " +
    "(Issue #888) so retried requests don't produce duplicate project-creation attempts.",
  tags: ["Splits"],
  request: {
    headers: idempotencyKeyHeaderSchema,
    body: {
      content: {
        "application/json": {
          schema: createSplitSchema,
          example: {
            owner: EXAMPLE_OWNER,
            projectId: EXAMPLE_PROJECT_ID,
            title: "Afrobeats Collective Vol. 1",
            projectType: "music",
            token: EXAMPLE_TOKEN,
            collaborators: [
              { address: EXAMPLE_COLLAB_A, alias: "Producer", basisPoints: 6000 },
              { address: EXAMPLE_COLLAB_B, alias: "Vocalist", basisPoints: 4000 },
            ],
          },
        },
      },
    },
  },
  responses: {
    200: {
      description: "Unsigned transaction XDR ready for the owner to sign and submit",
      content: {
        "application/json": {
          schema: XdrResponseSchema,
          example: xdrExample("create_project"),
        },
      },
    },
    ...standardErrorResponses({
      badRequest: true,
      conflict: true,
      conflictExample: {
        error: "IDEMPOTENCY_KEY_CONFLICT",
        code: "IDEMPOTENCY_KEY_CONFLICT",
        message: "Idempotency-Key was already used with a different request payload.",
        requestId: EXAMPLE_REQUEST_ID,
      },
      badGateway: true,
      serverError: true,
      badRequestExample: {
        error: "VALIDATION_ERROR",
        message: "collaborators basisPoints must sum to exactly 10000",
        requestId: EXAMPLE_REQUEST_ID,
        details: { path: ["collaborators"] },
      },
    }),
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
    params: z.object({ projectId: exampleProjectIdParam }),
    body: {
      content: {
        "application/json": {
          schema: depositSchema,
          example: {
            from: EXAMPLE_COLLAB_A,
            amount: 50_000_000,
          },
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
          example: xdrExample("deposit"),
        },
      },
    },
    ...standardErrorResponses({
      badRequest: true,
      notFound: true,
      badGateway: true,
      serverError: true,
      badRequestExample: {
        error: "VALIDATION_ERROR",
        message: "amount must be greater than 0",
        requestId: EXAMPLE_REQUEST_ID,
        details: { path: ["amount"] },
      },
    }),
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
  description:
    "Builds an unsigned XDR to replace the collaborator list and revenue share allocations. " +
    "Fails validation if any address repeats or shares don't sum to 10,000 basis points; " +
    "the frontend CreateSplitWizard performs the same duplicate/casing checks client-side, " +
    "but this endpoint is the source of truth.",
  tags: ["Splits"],
  request: {
    params: z.object({ projectId: exampleProjectIdParam }),
    body: {
      content: {
        "application/json": {
          schema: updateCollaboratorsSchema,
          example: {
            owner: EXAMPLE_OWNER,
            collaborators: [
              { address: EXAMPLE_COLLAB_A, alias: "Producer", basisPoints: 5000 },
              { address: EXAMPLE_COLLAB_B, alias: "Vocalist", basisPoints: 5000 },
            ],
          },
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
          example: xdrExample("update_collaborators"),
        },
      },
    },
    ...standardErrorResponses({
      badRequest: true,
      notFound: true,
      badGateway: true,
      serverError: true,
      badRequestExample: {
        error: "VALIDATION_ERROR",
        message: "duplicate collaborator address found",
        requestId: EXAMPLE_REQUEST_ID,
        details: { path: ["collaborators"] },
      },
    }),
  },
});

registry.registerPath({
  method: "post",
  path: "/splits/{projectId}/distribute",
  summary: "Distribute project funds to collaborators",
  description: "Builds an unsigned XDR to distribute accumulated project funds according to collaborator shares.",
  tags: ["Splits"],
  request: {
    params: z.object({ projectId: exampleProjectIdParam }),
    body: {
      content: {
        "application/json": {
          schema: distributeSchema,
          example: {
            sourceAddress: EXAMPLE_OWNER,
          },
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
          example: xdrExample("distribute"),
        },
      },
    },
    ...standardErrorResponses({
      badRequest: true,
      notFound: true,
      badGateway: true,
      serverError: true,
      badRequestExample: {
        error: "VALIDATION_ERROR",
        message: "Invalid projectId format.",
        requestId: EXAMPLE_REQUEST_ID,
        details: { path: ["projectId"] },
      },
    }),
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
  description:
    "Returns paginated on-chain distribution (`round`) and payout (`payment`) events for a project, " +
    "newest first. Pass the previous response's `nextCursor` back as the `cursor` query parameter to page forward.",
  tags: ["Splits"],
  request: {
    params: z.object({ projectId: exampleProjectIdParam }),
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
          example: {
            items: [
              {
                type: "payment",
                recipient: EXAMPLE_COLLAB_A,
                amount: "3000000",
                txHash: EXAMPLE_TX_HASH,
                ledgerCloseTime: "1732012800",
                id: "0000012345678901234-0000000001",
              },
              {
                type: "round",
                round: 3,
                amount: "5000000",
                txHash: EXAMPLE_TX_HASH,
                ledgerCloseTime: "1732012700",
                id: "0000012345678901233-0000000001",
              },
            ],
            nextCursor: "0000012345678901233-0000000001",
          },
        },
      },
    },
    ...standardErrorResponses({
      badRequest: true,
      notFound: true,
      badGateway: true,
      serverError: true,
      badRequestExample: {
        error: "VALIDATION_ERROR",
        message: "Invalid query parameters.",
        requestId: EXAMPLE_REQUEST_ID,
        details: { message: "Check cursor and limit parameters." },
      },
    }),
  },
});

// ─── Events (Server-Sent Events) ───────────────────────────────────────────────
//
// Both endpoints hold the HTTP response open and stream `text/event-stream`
// frames; OpenAPI 3.0 has no native way to type individual named SSE events,
// so the shape of each event's `data:` payload is documented in the
// description and mirrored from backend/src/__tests__/events.test.ts and
// events-transactions-sse.test.ts.

registry.registerPath({
  method: "get",
  path: "/events",
  summary: "Observe transaction status updates for a submitted XDR (SSE)",
  description:
    "Opens a Server-Sent Events stream and emits a `transaction_update` event each time the " +
    "backend observes an update for the given `txHash`. Limited to 5 concurrent subscribers " +
    "per `txHash` (configurable via `SSE_MAX_LISTENERS_PER_TXHASH`); exceeding it returns 429.\n\n" +
    "Example frame:\n" +
    "```\n" +
    "event: transaction_update\n" +
    `data: {"txHash":"${EXAMPLE_TX_HASH}","status":"pending"}\n` +
    "\n" +
    "```",
  tags: ["Events"],
  request: {
    query: z.object({
      txHash: z.string().min(1).openapi({ example: EXAMPLE_TX_HASH }).describe("Transaction hash to observe"),
    }),
  },
  responses: {
    200: {
      description: "text/event-stream of `transaction_update` frames (connection stays open)",
      content: {
        "text/event-stream": {
          schema: z.string().openapi({
            example: `event: transaction_update\ndata: {"txHash":"${EXAMPLE_TX_HASH}","status":"pending"}\n\n`,
          }),
        },
      },
    },
    429: {
      description: "Too many concurrent subscribers for this txHash",
      content: {
        "application/json": {
          schema: ApiErrorSchema,
          example: {
            error: "too_many_event_listeners",
            code: "RESOURCE_LIMIT_EXCEEDED",
            message: "Too many event stream subscribers for this transaction.",
            requestId: EXAMPLE_REQUEST_ID,
            details: { txHash: EXAMPLE_TX_HASH, limit: 5 },
          },
        },
      },
    },
    ...standardErrorResponses({ badRequest: true }),
  },
});

registry.registerPath({
  method: "get",
  path: "/events/transactions/{txHash}",
  summary: "Observe a single transaction until it's confirmed (SSE)",
  description:
    "Opens a Server-Sent Events stream and emits one `transaction:confirmed` event with the " +
    "full transaction record once `EventListenerService` observes it on-chain. Sends a `: heartbeat` " +
    "comment every 15s to keep intermediary proxies from closing the connection.\n\n" +
    "Example frame:\n" +
    "```\n" +
    "event: transaction:confirmed\n" +
    `data: {"txHash":"${EXAMPLE_TX_HASH}","roundId":"${EXAMPLE_PROJECT_ID}","recipient":"${EXAMPLE_COLLAB_A}","amount":"1000","token":"native","timestamp":1732012800,"status":"completed"}\n` +
    "\n" +
    "```",
  tags: ["Events"],
  request: {
    params: z.object({
      txHash: z.string().min(1).openapi({ example: EXAMPLE_TX_HASH }),
    }),
  },
  responses: {
    200: {
      description: "text/event-stream of a single `transaction:confirmed` frame (connection stays open until then)",
      content: {
        "text/event-stream": {
          schema: z.string().openapi({
            example:
              `event: transaction:confirmed\ndata: {"txHash":"${EXAMPLE_TX_HASH}","roundId":"${EXAMPLE_PROJECT_ID}",` +
              `"recipient":"${EXAMPLE_COLLAB_A}","amount":"1000","token":"native","timestamp":1732012800,"status":"completed"}\n\n`,
          }),
        },
      },
    },
    ...standardErrorResponses({ badRequest: true }),
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
  security: [{ adminApiKey: [] }],
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
    ...standardErrorResponses({ badRequest: true, unauthorized: true, forbidden: true, badGateway: true, serverError: true }),
  },
});

registry.registerPath({
  method: "post",
  path: "/splits/admin/allow-token",
  summary: "Allow a payment token",
  description: "Builds an unsigned XDR to add a token to the contract allowlist. Requires admin API key.",
  tags: ["Admin"],
  security: [{ adminApiKey: [] }],
  request: {
    body: { content: { "application/json": { schema: adminTokenSchema } } },
  },
  responses: {
    200: { description: "Unsigned transaction XDR", content: { "application/json": { schema: XdrResponseSchema } } },
    ...standardErrorResponses({ badRequest: true, unauthorized: true, forbidden: true, unavailable: true, badGateway: true, serverError: true }),
  },
});

registry.registerPath({
  method: "post",
  path: "/splits/admin/disallow-token",
  summary: "Disallow a payment token",
  description: "Builds an unsigned XDR to remove a token from the contract allowlist. Requires admin API key.",
  tags: ["Admin"],
  security: [{ adminApiKey: [] }],
  request: {
    body: { content: { "application/json": { schema: adminTokenSchema } } },
  },
  responses: {
    200: { description: "Unsigned transaction XDR", content: { "application/json": { schema: XdrResponseSchema } } },
    ...standardErrorResponses({ badRequest: true, unauthorized: true, forbidden: true, unavailable: true, badGateway: true, serverError: true }),
  },
});

registry.registerPath({
  method: "post",
  path: "/splits/admin/pause-distributions",
  summary: "Pause all distributions",
  description: "Builds an unsigned XDR to pause contract-wide fund distributions. Requires admin API key.",
  tags: ["Admin"],
  security: [{ adminApiKey: [] }],
  request: {
    body: { content: { "application/json": { schema: pauseDistributionsSchema } } },
  },
  responses: {
    200: { description: "Unsigned transaction XDR", content: { "application/json": { schema: XdrResponseSchema } } },
    ...standardErrorResponses({ badRequest: true, unauthorized: true, forbidden: true, unavailable: true, badGateway: true, serverError: true }),
  },
});

registry.registerPath({
  method: "post",
  path: "/splits/admin/unpause-distributions",
  summary: "Unpause distributions",
  description: "Builds an unsigned XDR to resume contract-wide fund distributions. Requires admin API key.",
  tags: ["Admin"],
  security: [{ adminApiKey: [] }],
  request: {
    body: { content: { "application/json": { schema: pauseDistributionsSchema } } },
  },
  responses: {
    200: { description: "Unsigned transaction XDR", content: { "application/json": { schema: XdrResponseSchema } } },
    ...standardErrorResponses({ badRequest: true, unauthorized: true, forbidden: true, unavailable: true, badGateway: true, serverError: true }),
  },
});

registry.registerPath({
  method: "get",
  path: "/splits/admin/status",
  summary: "Get admin contract status",
  description: "Returns the current contract admin address and whether distributions are paused.",
  tags: ["Admin"],
  security: [{ adminApiKey: [] }],
  responses: {
    200: {
      description: "Admin status",
      content: { "application/json": { schema: AdminStatusSchema } },
    },
    ...standardErrorResponses({ unauthorized: true, forbidden: true, badGateway: true, serverError: true }),
  },
});

registry.registerPath({
  method: "get",
  path: "/splits/admin/is-token-allowed",
  summary: "Check if a token is allowed",
  description: "Returns whether a specific token contract address is on the allowlist.",
  tags: ["Admin"],
  security: [{ adminApiKey: [] }],
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
    ...standardErrorResponses({ badRequest: true, unauthorized: true, forbidden: true, badGateway: true, serverError: true }),
  },
});

registry.registerPath({
  method: "get",
  path: "/splits/admin/token-count",
  summary: "Get allowed token count",
  description: "Returns the total number of tokens on the contract allowlist.",
  tags: ["Admin"],
  security: [{ adminApiKey: [] }],
  responses: {
    200: {
      description: "Allowed token count",
      content: {
        "application/json": {
          schema: z.object({ count: z.number().int() }),
        },
      },
    },
    ...standardErrorResponses({ unauthorized: true, forbidden: true, badGateway: true, serverError: true }),
  },
});

registry.registerPath({
  method: "get",
  path: "/splits/admin/unallocated",
  summary: "Get unallocated token balance",
  description: "Returns the unallocated balance held by the contract for a given token.",
  tags: ["Admin"],
  security: [{ adminApiKey: [] }],
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
    ...standardErrorResponses({ badRequest: true, unauthorized: true, forbidden: true, badGateway: true, serverError: true }),
  },
});

registry.registerPath({
  method: "post",
  path: "/splits/admin/withdraw-unallocated",
  summary: "Withdraw unallocated tokens",
  description: "Builds an unsigned XDR to recover unallocated token balance from the contract. Requires admin API key.",
  tags: ["Admin"],
  security: [{ adminApiKey: [] }],
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
  security: [{ adminApiKey: [] }],
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

registry.register(
  "HealthResponse",
  z.object({
    status: z.enum(["ok", "degraded", "not_ready"]),
    uptime: z.number().optional().describe("Server uptime in seconds"),
    timestamp: z.string().optional().describe("ISO 8601 timestamp"),
  })
);

// Issue #935: per-dependency 3-way status. A dependency is "up" if it
// responds within its configured latency threshold, "degraded" if it
// responds successfully but slower than that threshold, and "down" if it
// errors or times out outright. Thresholds are configurable via
// HEALTH_DB_DEGRADED_LATENCY_MS (default 500ms) and
// HEALTH_RPC_DEGRADED_LATENCY_MS (default 1500ms, applied to both the
// Soroban RPC and contract-simulation checks).
const ComponentHealthSchema = registry.register(
  "ComponentHealth",
  z.object({
    status: z.enum(["up", "degraded", "down"]),
    latencyMs: z.number().optional().describe("Round-trip latency of the underlying check, in milliseconds"),
    message: z
      .string()
      .optional()
      .describe("Redacted, human-readable detail. Never contains secrets or raw connection strings."),
  })
);

const EnvComponentHealthSchema = registry.register(
  "EnvComponentHealth",
  z.object({
    ok: z.boolean().describe("Whether required environment variables are present and valid"),
  })
);

const EventListenerComponentHealthSchema = registry.register(
  "EventListenerComponentHealth",
  z.object({
    status: z.enum(["stopped", "healthy", "degraded"]),
    lastSuccessfulPoll: z.string().nullable().describe("ISO 8601 timestamp of the last successful poll, or null"),
    consecutiveErrors: z.number().int().describe("Number of consecutive failing polls"),
  })
);

const ReadinessComponentsSchema = registry.register(
  "ReadinessComponents",
  z.object({
    env: EnvComponentHealthSchema,
    db: ComponentHealthSchema,
    rpc: ComponentHealthSchema,
    contract: ComponentHealthSchema,
    eventListener: EventListenerComponentHealthSchema.optional(),
  })
);

const ReadinessResponseSchema = registry.register(
  "ReadinessResponse",
  z.object({
    status: z.enum(["ready", "degraded", "not_ready"]).describe(
      "Issue #935 status/status-code policy: \"ready\" -> 200 (all dependencies up); " +
      "\"degraded\" -> 200 (service still usable, but at least one dependency is slow " +
      "or in a non-fatal failure state - investigate, don't page); \"not_ready\" -> 503 " +
      "(env invalid or a dependency is fully down, unchanged from the legacy binary contract)."
    ),
    error: z.string().optional().describe("Error code if not ready"),
    message: z.string().optional().describe("Error message if not ready"),
    issues: z.array(z.string()).optional().describe("List of configuration issues"),
    requestId: z.string().optional().describe("Request ID for tracing"),
    components: ReadinessComponentsSchema.optional(),
  })
);

registry.registerPath({
  method: "get",
  path: "/health",
  summary: "Get readiness status (alias for /health/ready)",
  description:
    "Alias for /health/ready. Returns 200 for both \"ready\" and \"degraded\" (service still usable); " +
    "503 only for \"not_ready\" (Issue #935).",
  tags: ["Health"],
  responses: {
    200: {
      description: "Server is ready to accept traffic, or degraded but still usable",
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
  description:
    "Issue #935: returns 200 with status \"ready\" (all dependencies up) or \"degraded\" " +
    "(usable, but db/rpc/contract/eventListener is slow or non-fatally impaired); " +
    "returns 503 with status \"not_ready\" only when env is invalid or a dependency is " +
    "fully down. See docs/runbooks/observability.md for the on-call interpretation of each state.",
  tags: ["Health"],
  responses: {
    200: {
      description: "Server is ready to accept traffic, or degraded but still usable",
      content: {
        "application/json": {
          schema: ReadinessResponseSchema,
        },
      },
    },
    503: {
      description: "Server is not ready (missing configuration or a dependency is down)",
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
    details: z.record(z.string(), z.any()).optional(),
    components: z.object({
      env: z.object({
        ok: z.boolean(),
        message: z.string().optional(),
        details: z.record(z.string(), z.any()).optional()
      }),
      db: z.object({
        ok: z.boolean(),
        message: z.string().optional(),
        details: z.record(z.string(), z.any()).optional()
      }),
      cache: z.object({
        ok: z.boolean(),
        message: z.string().optional(),
        details: z.record(z.string(), z.any()).optional()
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

// ─── Admin and Operations Endpoints ───────────────────────────────────────────

const AdminStatusResponseSchema = registry.register(
  "AdminStatusResponse",
  z.object({
    admin: z.string().nullable().describe("Current contract admin Stellar address or null"),
    isPaused: z.boolean().describe("Whether contract distributions are globally paused"),
  })
);

const AdminIsTokenAllowedResponseSchema = registry.register(
  "AdminIsTokenAllowedResponse",
  z.object({
    token: z.string().describe("Token contract address checked"),
    isAllowed: z.boolean().describe("Whether token is allowlisted"),
  })
);

const AdminTokenCountResponseSchema = registry.register(
  "AdminTokenCountResponse",
  z.object({
    count: z.number().int().describe("Number of allowlisted tokens"),
  })
);

const AdminUnallocatedResponseSchema = registry.register(
  "AdminUnallocatedResponse",
  z.object({
    token: z.string().describe("Token contract address"),
    unallocated: z.string().describe("Recoverable unallocated stroops as string"),
  })
);

const AdminCacheStatsResponseSchema = registry.register(
  "AdminCacheStatsResponse",
  z.object({
    size: z.number().int().describe("Number of active cached entries"),
    keys: z.array(z.string()).describe("Cached key prefixes or names"),
    hits: z.number().int().optional().describe("Cache hit count"),
    misses: z.number().int().optional().describe("Cache miss count"),
    hitRate: z.number().optional().describe("Cache hit ratio"),
    ttlMs: z.number().int().describe("Configured cache TTL in milliseconds"),
  })
);

const AdminUnsignedXdrResponseSchema = registry.register(
  "AdminUnsignedXdrResponse",
  z.object({
    xdr: z.string().describe("Base64 encoded unsigned transaction envelope"),
    metadata: z.object({
      contractId: z.string().describe("Deployed contract ID"),
      networkPassphrase: z.string().describe("Stellar network passphrase"),
      sourceAccount: z.string().describe("Admin source account address"),
      sequenceNumber: z.string().optional().describe("Account sequence number"),
      fee: z.string().optional().describe("Transaction fee in stroops"),
      operation: z.string().describe("Invoked contract method name"),
      auditContext: z.record(z.string(), z.any()).optional().describe("Audit logging context metadata"),
    }),
  })
);

const OpsStatusResponseSchema = registry.register(
  "OpsStatusResponse",
  z.object({
    eventListener: z.object({
      status: z.string().describe("EventListener lifecycle status"),
      lastSuccessfulPoll: z.string().nullable().optional().describe("ISO timestamp of last successful poll"),
      consecutiveErrors: z.number().int().optional().describe("Count of consecutive poll failures"),
      ledgerLag: z.number().optional().describe("Lag behind latest ledger"),
    }),
    database: z.object({
      connected: z.boolean().describe("Whether database data-source is initialized"),
    }),
    idempotency: z.object({
      conflictsTotal: z.number().int().nonnegative().describe("Total idempotency 409 conflicts"),
      replaysTotal: z.number().int().nonnegative().describe("Total idempotency replays"),
    }).optional().describe("Idempotency conflict and replay counters"),
  })
);

const OpsBackfillResponseSchema = registry.register(
  "OpsBackfillResponse",
  z.object({
    success: z.boolean().describe("Whether backfill operation completed"),
    message: z.string().optional().describe("Human-readable status message"),
    error: z.string().optional().describe("Error details if backfill failed"),
  })
);

registry.registerPath({
  method: "get",
  path: "/splits/admin/status",
  summary: "Get contract admin and pause status",
  description: "Returns the current contract admin address and pause state. Protected by payments admin authorization.",
  tags: ["Admin"],
  security: [{ adminApiKey: [] }],
  responses: {
    200: {
      description: "Admin and distribution pause status",
      content: { "application/json": { schema: AdminStatusResponseSchema } },
    },
    ...standardErrorResponses({ unauthorized: true, serverError: true }),
  },
});

registry.registerPath({
  method: "get",
  path: "/splits/admin/is-token-allowed",
  summary: "Check if a token is allowlisted",
  description: "Queries whether a given token address is allowed on the contract. Protected by payments admin authorization.",
  tags: ["Admin"],
  security: [{ adminApiKey: [] }],
  request: {
    query: isTokenAllowedQuerySchema,
  },
  responses: {
    200: {
      description: "Token allowlist status",
      content: { "application/json": { schema: AdminIsTokenAllowedResponseSchema } },
    },
    ...standardErrorResponses({ badRequest: true, unauthorized: true, serverError: true }),
  },
});

registry.registerPath({
  method: "get",
  path: "/splits/admin/token-count",
  summary: "Get allowed token count",
  description: "Returns the total number of allowlisted tokens. Protected by payments admin authorization.",
  tags: ["Admin"],
  security: [{ adminApiKey: [] }],
  responses: {
    200: {
      description: "Allowed token count",
      content: { "application/json": { schema: AdminTokenCountResponseSchema } },
    },
    ...standardErrorResponses({ unauthorized: true, serverError: true }),
  },
});

registry.registerPath({
  method: "get",
  path: "/splits/admin/unallocated",
  summary: "Get unallocated token balance",
  description: "Returns the recoverable unallocated token balance on the contract. Protected by payments admin authorization.",
  tags: ["Admin"],
  security: [{ adminApiKey: [] }],
  request: {
    query: unallocatedQuerySchema,
  },
  responses: {
    200: {
      description: "Unallocated token balance in stroops",
      content: { "application/json": { schema: AdminUnallocatedResponseSchema } },
    },
    ...standardErrorResponses({ badRequest: true, unauthorized: true, serverError: true }),
  },
});

registry.registerPath({
  method: "get",
  path: "/splits/admin/cache-stats",
  summary: "Get read-cache diagnostic stats",
  description: "Returns in-memory read cache statistics and TTL configuration.",
  tags: ["Admin"],
  security: [{ adminApiKey: [] }],
  responses: {
    200: {
      description: "Cache statistics",
      content: { "application/json": { schema: AdminCacheStatsResponseSchema } },
    },
    ...standardErrorResponses({ unauthorized: true, serverError: true }),
  },
});

registry.registerPath({
  method: "post",
  path: "/splits/admin/allow-token",
  summary: "Allow a token on the contract",
  description: "Builds an unsigned transaction XDR to add a token to the allowlist. Requires admin authorization.",
  tags: ["Admin"],
  security: [{ adminApiKey: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: adminTokenSchema,
          example: {
            admin: EXAMPLE_OWNER,
            token: EXAMPLE_TOKEN,
          },
        },
      },
    },
  },
  responses: {
    200: {
      description: "Unsigned transaction XDR",
      content: { "application/json": { schema: AdminUnsignedXdrResponseSchema } },
    },
    ...standardErrorResponses({ badRequest: true, unauthorized: true, unavailable: true, serverError: true }),
  },
});

registry.registerPath({
  method: "post",
  path: "/splits/admin/disallow-token",
  summary: "Disallow a token on the contract",
  description: "Builds an unsigned transaction XDR to remove a token from the allowlist. Requires admin authorization.",
  tags: ["Admin"],
  security: [{ adminApiKey: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: adminTokenSchema,
          example: {
            admin: EXAMPLE_OWNER,
            token: EXAMPLE_TOKEN,
          },
        },
      },
    },
  },
  responses: {
    200: {
      description: "Unsigned transaction XDR",
      content: { "application/json": { schema: AdminUnsignedXdrResponseSchema } },
    },
    ...standardErrorResponses({ badRequest: true, unauthorized: true, unavailable: true, serverError: true }),
  },
});

registry.registerPath({
  method: "post",
  path: "/splits/admin/pause-distributions",
  summary: "Pause all contract distributions",
  description: "Builds an unsigned transaction XDR to pause contract-wide distributions. Requires admin authorization.",
  tags: ["Admin"],
  security: [{ adminApiKey: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: pauseDistributionsSchema,
          example: {
            admin: EXAMPLE_OWNER,
          },
        },
      },
    },
  },
  responses: {
    200: {
      description: "Unsigned transaction XDR",
      content: { "application/json": { schema: AdminUnsignedXdrResponseSchema } },
    },
    ...standardErrorResponses({ badRequest: true, unauthorized: true, unavailable: true, serverError: true }),
  },
});

registry.registerPath({
  method: "post",
  path: "/splits/admin/unpause-distributions",
  summary: "Unpause contract distributions",
  description: "Builds an unsigned transaction XDR to unpause contract-wide distributions. Requires admin authorization.",
  tags: ["Admin"],
  security: [{ adminApiKey: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: pauseDistributionsSchema,
          example: {
            admin: EXAMPLE_OWNER,
          },
        },
      },
    },
  },
  responses: {
    200: {
      description: "Unsigned transaction XDR",
      content: { "application/json": { schema: AdminUnsignedXdrResponseSchema } },
    },
    ...standardErrorResponses({ badRequest: true, unauthorized: true, unavailable: true, serverError: true }),
  },
});

registry.registerPath({
  method: "post",
  path: "/splits/admin/withdraw-unallocated",
  summary: "Withdraw unallocated contract funds",
  description: "Builds an unsigned transaction XDR to recover unallocated funds. Includes audit context.",
  tags: ["Admin"],
  security: [{ adminApiKey: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: withdrawUnallocatedSchema,
          example: {
            admin: EXAMPLE_OWNER,
            token: EXAMPLE_TOKEN,
            to: EXAMPLE_COLLAB_A,
            amount: 500000,
          },
        },
      },
    },
  },
  responses: {
    200: {
      description: "Unsigned transaction XDR with audit context",
      content: { "application/json": { schema: AdminUnsignedXdrResponseSchema } },
    },
    ...standardErrorResponses({ badRequest: true, unauthorized: true, unavailable: true, serverError: true }),
  },
});

registry.registerPath({
  method: "get",
  path: "/ops/status",
  summary: "Get operational service health and lag",
  description: "Returns status of the event listener service, ledger lag, and database connection.",
  tags: ["Operations"],
  responses: {
    200: {
      description: "Operations status",
      content: { "application/json": { schema: OpsStatusResponseSchema } },
    },
    ...standardErrorResponses({ serverError: true }),
  },
});

registry.registerPath({
  method: "post",
  path: "/ops/backfill",
  summary: "Trigger event history backfill",
  description: "Backfills missed ledger events starting from a given ledger sequence.",
  tags: ["Operations"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            fromLedger: z.number().int().optional().describe("Starting ledger sequence number"),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Backfill outcome",
      content: { "application/json": { schema: OpsBackfillResponseSchema } },
    },
    ...standardErrorResponses({ serverError: true }),
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

registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
  description: "JWT obtained from POST /users/login",
});

registry.registerComponent("securitySchemes", "adminApiKey", {
  type: "apiKey",
  in: "header",
  name: "x-admin-api-key",
  description: "Payments admin API key for /splits/admin mutation endpoints",
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
  });
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce((acc: Record<string, unknown>, key: string) => {
        acc[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
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
  // Allow CI drift-check scripts to redirect output to a temp path by
  // setting OPENAPI_OUTPUT_DIR. Falls back to the standard docs/ location.
  const docsDir = process.env.OPENAPI_OUTPUT_DIR
    ? path.resolve(process.env.OPENAPI_OUTPUT_DIR)
    : path.join(path.dirname(__filename), "..", "..", "docs");
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }
  const yamlContent = yaml.stringify(spec);
  const outputYamlPath = path.join(docsDir, "openapi.yaml");
  fs.writeFileSync(outputYamlPath, yamlContent);
  const outputJsonPath = path.join(docsDir, "openapi.json");
  const parsedSpec = yaml.parse(yamlContent);
  fs.writeFileSync(outputJsonPath, `${JSON.stringify(sortKeysDeep(parsedSpec), null, 2)}\n`);
  logger.info(`OpenAPI spec generated at ${outputYamlPath} and ${outputJsonPath}`);
}
