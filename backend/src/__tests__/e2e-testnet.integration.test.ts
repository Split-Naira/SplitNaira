/**
 * Issue #369: Live testnet integration test (nightly)
 *
 * Unlike `e2e-happy-path.test.ts` (which mocks all Stellar RPC for reproducible
 * unit runs), this suite exercises the same happy-path flow against a REAL
 * Soroban testnet so deployment-breaking RPC/contract changes are caught early.
 *
 * It is gated behind `RUN_TESTNET_INTEGRATION=1` and the required testnet
 * config, so it is SKIPPED in normal CI/unit runs and only executes in the
 * scheduled `testnet-integration` workflow (which injects the secrets).
 *
 * The API builds/simulates unsigned XDR, so a "happy path" here means each
 * endpoint successfully reaches the live RPC and the deployed contract:
 *   - create_project  → real getAccount + simulate against the contract
 *   - history         → real getEvents + event decoding
 *   - deposit (opt.)  → build/simulate against an existing testnet project
 * No transaction is signed or submitted (the API never signs).
 *
 * Required env (set by the workflow from secrets):
 *   RUN_TESTNET_INTEGRATION=1
 *   SOROBAN_RPC_URL, SOROBAN_NETWORK_PASSPHRASE, HORIZON_URL, CONTRACT_ID
 *   SIMULATOR_ACCOUNT and/or TESTNET_SOURCE_ACCOUNT  (a funded testnet G... key)
 * Optional:
 *   TESTNET_TOKEN       (a SAC contract id; enables the create_project step)
 *   TESTNET_PROJECT_ID  (an existing project; enables the deposit step)
 */

import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";

import { app } from "../index.js";

const RUN = process.env.RUN_TESTNET_INTEGRATION === "1";
const suite = RUN ? describe : describe.skip;

const SOURCE = process.env.TESTNET_SOURCE_ACCOUNT || process.env.SIMULATOR_ACCOUNT || "";
const TOKEN = process.env.TESTNET_TOKEN || "";
const EXISTING_PROJECT_ID = process.env.TESTNET_PROJECT_ID || "";

suite("E2E (live testnet): happy-path build/simulate against real RPC", () => {
  beforeAll(() => {
    const required = ["SOROBAN_RPC_URL", "SOROBAN_NETWORK_PASSPHRASE", "HORIZON_URL", "CONTRACT_ID"];
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length > 0) {
      throw new Error(`Missing required testnet env: ${missing.join(", ")}`);
    }
    if (!SOURCE) {
      throw new Error("Set TESTNET_SOURCE_ACCOUNT or SIMULATOR_ACCOUNT to a funded testnet account.");
    }
  });

  // Always-on: needs only CONTRACT_ID + RPC. Verifies the event pipeline
  // (getEvents + decoding) against the live network.
  it("history endpoint reaches live getEvents and returns a decoded list", async () => {
    const id = EXISTING_PROJECT_ID || `nightly_probe_${Date.now()}`;
    const res = await request(app).get(`/splits/${id}/history`);

    expect(res.status, `[history] ${JSON.stringify(res.body)}`).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  // Needs a funded source + a real SAC token. Verifies getAccount + simulate
  // against the deployed contract's create_project entry point.
  it.runIf(TOKEN !== "")(
    "create_project builds and simulates against the live contract",
    async () => {
      const projectId = `nightly_${Date.now()}`;
      const res = await request(app)
        .post("/splits")
        .send({
          owner: SOURCE,
          projectId,
          title: "Nightly Testnet Integration",
          projectType: "music",
          token: TOKEN,
          collaborators: [{ address: SOURCE, alias: "Nightly", basisPoints: 10000 }],
        });

      expect(res.status, `[create] ${JSON.stringify(res.body)}`).toBe(200);
      expect(typeof res.body.xdr).toBe("string");
      expect(res.body.metadata).toMatchObject({ operation: "create_project", sourceAccount: SOURCE });
    },
  );

  // Needs an existing on-chain project. Verifies deposit build/simulate against
  // real project state.
  it.runIf(EXISTING_PROJECT_ID !== "")(
    "deposit builds and simulates against an existing testnet project",
    async () => {
      const res = await request(app)
        .post(`/splits/${EXISTING_PROJECT_ID}/deposit`)
        .send({ from: SOURCE, amount: 10_000_000 });

      expect(res.status, `[deposit] ${JSON.stringify(res.body)}`).toBe(200);
      expect(typeof res.body.xdr).toBe("string");
    },
  );
});
