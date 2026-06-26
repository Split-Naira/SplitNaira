import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

type ContractInterfaceArtifact = {
  schemaVersion: number;
  generatedBy: string;
  methods: Array<{
    name: string;
    args: Array<{ name: string; type: string }>;
    returnType: string;
    mutability: string;
  }>;
  events: Array<{
    name: string;
    topics: Array<{ position: number; type: string; value?: string; field?: string }>;
    data: { field?: string; tupleFields?: string[] };
  }>;
  types: Record<string, { fields?: Array<{ name: string; type: string }> }>;
  errors: Array<{ name: string; code: number }>;
};

const contractInterface = JSON.parse(
  readFileSync(
    new URL("../../../contracts/interface/splitnaira.contract-interface.json", import.meta.url),
    "utf8"
  )
) as ContractInterfaceArtifact;

function contractMethod(name: string) {
  const method = contractInterface.methods.find((entry) => entry.name === name);
  if (!method) {
    throw new Error(`Contract interface artifact is missing method: ${name}`);
  }
  return method;
}

function contractEvent(name: string) {
  const event = contractInterface.events.find((entry) => entry.name === name);
  if (!event) {
    throw new Error(`Contract interface artifact is missing event: ${name}`);
  }
  return event;
}

describe("contract interface artifact", () => {
  it("is available for backend and frontend tooling", () => {
    expect(contractInterface.schemaVersion).toBe(1);
    expect(contractInterface.generatedBy).toBe("contracts/scripts/generate-interface.mjs");
    expect(contractInterface.methods.length).toBeGreaterThanOrEqual(27);
    expect(contractInterface.events.length).toBeGreaterThanOrEqual(7);
    expect(contractInterface.errors).toHaveLength(19);
  });

  it("covers backend write and read contract calls", () => {
    const backendWriteMethods = [
      "create_project",
      "lock_project",
      "deposit",
      "distribute",
      "update_collaborators",
      "update_project_metadata",
      "allow_token",
      "disallow_token",
      "pause_distributions",
      "unpause_distributions",
      "withdraw_unallocated",
      "transfer_project_ownership"
    ];

    const backendReadMethods = [
      "list_projects",
      "get_project",
      "get_claimable",
      "get_admin",
      "get_allowed_token_count",
      "get_allowed_tokens",
      "is_distributions_paused",
      "is_token_allowed",
      "get_unallocated_balance"
    ];

    for (const name of backendWriteMethods) {
      expect(contractMethod(name).mutability).toBe("write");
    }
    for (const name of backendReadMethods) {
      expect(contractMethod(name).mutability).toBe("read");
    }
  });

  it("keeps app event handling aligned with on-chain topics and data", () => {
    expect(contractEvent("distribution_complete")).toMatchObject({
      topics: [
        { position: 0, type: "Symbol", value: "distribution_complete" },
        { position: 1, type: "from_field", field: "project_id" }
      ],
      data: { tupleFields: ["round", "total"] }
    });

    expect(contractEvent("payment_sent")).toMatchObject({
      topics: [
        { position: 0, type: "Symbol", value: "payment_sent" },
        { position: 1, type: "from_field", field: "project_id" }
      ],
      data: { tupleFields: ["recipient", "amount"] }
    });
  });

  it("exposes app-facing contract types and argument order", () => {
    expect(contractInterface.types.Collaborator.fields).toEqual([
      expect.objectContaining({ name: "address", type: "Address" }),
      expect.objectContaining({ name: "alias", type: "String" }),
      expect.objectContaining({ name: "basis_points", type: "u32" })
    ]);

    expect(contractMethod("create_project").args).toEqual([
      { name: "owner", type: "Address" },
      { name: "project_id", type: "Symbol" },
      { name: "title", type: "String" },
      { name: "project_type", type: "String" },
      { name: "token", type: "Address" },
      { name: "collaborators", type: "Vec<Collaborator>" }
    ]);
  });

  it("generates TypeScript types that match the contract interface", async () => {
    // Test that generated types can be imported
    const { CollaboratorSchema, SplitProjectSchema, ContractErrors } = await import("../generated/contract-types.js");

    // Test that schemas validate contract interface structure
    expect(CollaboratorSchema.shape).toHaveProperty("address");
    expect(CollaboratorSchema.shape).toHaveProperty("alias");
    expect(CollaboratorSchema.shape).toHaveProperty("basis_points");

    expect(SplitProjectSchema.shape).toHaveProperty("project_id");
    expect(SplitProjectSchema.shape).toHaveProperty("collaborators");

    // Test that error codes match
    expect(ContractErrors.ProjectExists).toBe(1);
    expect(ContractErrors.Unauthorized).toBe(3);
    expect(Object.keys(ContractErrors)).toHaveLength(contractInterface.errors.length);
  });
});
