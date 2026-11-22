import { describe, expect, it } from "vitest";

import { generateOpenApi } from "../openapi.js";
import { SUBMISSION_EXPIRY_MS } from "../services/transaction-recovery.js";

type Schema = {
  $ref?: string;
  properties?: Record<string, { description?: string; enum?: string[] }>;
};

type Spec = {
  paths?: Record<
    string,
    Record<string, { description?: string; responses?: Record<string, { description?: string; content?: Record<string, { schema?: Schema }> }> }>
  >;
  components?: { schemas?: Record<string, Schema> };
};

function resolve(spec: Spec, schema?: Schema): Schema | undefined {
  if (!schema) return undefined;
  if (!schema.$ref) return schema;
  return spec.components?.schemas?.[schema.$ref.split("/").pop() as string];
}

describe("OpenAPI documents unknown transaction outcomes (#1636)", () => {
  const spec = generateOpenApi() as unknown as Spec;
  const reconcile = spec.paths?.["/transactions/recovery/attempts/{txHash}"]?.get;
  const register = spec.paths?.["/transactions/recovery/attempts"]?.post;

  it("explains that NOT_FOUND is unconfirmed, not failed, and must be polled", () => {
    expect(reconcile?.description).toContain("NOT_FOUND");
    expect(reconcile?.description).toContain("stays `pending`");
    expect(reconcile?.description).toContain("must be polled");
  });

  it("documents the bounded expiry that turns an unknown hash into a final failure", () => {
    expect(SUBMISSION_EXPIRY_MS).toBe(360_000);
    expect(reconcile?.description).toContain("6 minutes after `submittedAt`");
    expect(reconcile?.description).toContain("transaction_expired");
  });

  it("states the safe-retry restriction and the double-payment risk", () => {
    expect(reconcile?.description).toContain("never resubmit while `status` is `pending`");
    expect(reconcile?.description).toContain("pay collaborators twice");
    expect(reconcile?.description).toContain("Only `failed` is final");
  });

  it("describes registration as pending and idempotent by hash", () => {
    expect(register?.description).toContain("status: \"pending\"");
    expect(register?.description).toContain("idempotent");
    expect(register?.responses?.["200"]?.description).toContain("poll the GET endpoint");
    expect(register?.responses?.["409"]?.description).toContain("payout_attempt_conflict");
  });

  it("pins the recovery status enum and field-level outcome guidance", () => {
    const schema = resolve(spec, reconcile?.responses?.["200"]?.content?.["application/json"]?.schema);
    const status = schema?.properties?.status;
    const failureCode = schema?.properties?.failureCode;

    expect(status?.enum).toEqual(["pending", "completed", "failed"]);
    expect(status?.description).toContain("do not resubmit");
    expect(failureCode?.description).toContain("transaction_failed");
    expect(failureCode?.description).toContain("transaction_expired");
  });
});
