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
} from "./routes/splits.js";

const registry = new OpenAPIRegistry();

// ─── Components ───────────────────────────────────────────────────────────────

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

registry.registerPath({
  method: "get",
  path: "/splits/{projectId}/claimable/{address}",
  summary: "Get claimable info for a collaborator",
  tags: ["Splits"],
  request: {
    params: z.object({
      projectId: projectIdParamSchema,
      address: z.string(),
    }),
  },
  responses: {
    200: {
      description: "Claimable info",
      content: {
        "application/json": {
          schema: z.object({
            claimed: z.number(),
            claimable: z.number(),
          }),
        },
      },
    },
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
  console.log("OpenAPI spec generated at openapi/openapi.yaml");
}
