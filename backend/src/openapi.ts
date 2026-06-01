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
} from "./routes/splits.js";

const registry = new OpenAPIRegistry();

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
  },
});

registry.registerPath({
  method: "post",
  path: "/splits",
  summary: "Create a new split project",
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
  },
});

registry.registerPath({
  method: "get",
  path: "/splits/{projectId}",
  summary: "Get project details by ID",
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
    404: { description: "Project not found" },
  },
});

registry.registerPath({
  method: "post",
  path: "/splits/{projectId}/lock",
  summary: "Lock a project permanently",
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
  },
});

registry.registerPath({
  method: "post",
  path: "/splits/{projectId}/deposit",
  summary: "Deposit funds into a project",
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
  },
});

registry.registerPath({
  method: "patch",
  path: "/splits/{projectId}/metadata",
  summary: "Update project metadata (title/category)",
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
  },
});

registry.registerPath({
  method: "put",
  path: "/splits/{projectId}/collaborators",
  summary: "Update project collaborators",
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
  },
});

registry.registerPath({
  method: "post",
  path: "/splits/{projectId}/distribute",
  summary: "Distribute project funds to collaborators",
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
    400: { description: "Validation error — invalid projectId or collaborator address" },
    404: { description: "Project not found or collaborator has no claimable info" },
    500: { description: "Contract or server failure" },
  },
});

registry.registerPath({
  method: "get",
  path: "/splits/{projectId}/history",
  summary: "Get project transaction history",
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
          }),
        },
      },
    },
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
    status: z.enum(["ok", "not_ready"]),
    error: z.string().optional().describe("Error code if not ready"),
    message: z.string().optional().describe("Error message if not ready"),
    issues: z.array(z.string()).optional().describe("List of configuration issues"),
    requestId: z.string().optional().describe("Request ID for tracing"),
  })
);

registry.registerPath({
  method: "get",
  path: "/health",
  summary: "Get overall health status",
  tags: ["Health"],
  responses: {
    200: {
      description: "Server health information",
      content: {
        "application/json": {
          schema: HealthResponseSchema,
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
