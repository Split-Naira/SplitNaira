/**
 * Signed wallet challenge authentication (Issue #1232) — integration tests.
 *
 * The whole route, service, signature verification and JWT code runs for real
 * against an in-memory database stub; only the user repository lookup is
 * mocked, matching the pattern used by the other route integration tests.
 */
import express from "express";
import request from "supertest";
import { Keypair } from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAuthWalletRouter } from "../routes/auth-wallet.js";
import { WalletChallengeStore } from "../services/wallet-challenge.js";
import { verifyToken } from "../services/jwt.js";
import { errorHandler, notFoundHandler } from "../middleware/error.js";
import { requestIdMiddleware } from "../middleware/request-id.js";

const findOneMock = vi.fn();

vi.mock("../services/database.js", () => ({
  getDataSource: () => ({
    getRepository: () => ({ findOne: findOneMock }),
  }),
}));

const NOW = new Date("2026-11-22T10:00:00.000Z");

function makeUser(walletAddress: string, overrides: Record<string, unknown> = {}) {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    walletAddress,
    email: "user@example.com",
    alias: "TestUser",
    role: "user",
    isActive: true,
    deletedAt: null,
    sessionVersion: 3,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function createApp(store = new WalletChallengeStore()) {
  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware);
  app.use("/auth/wallet", createAuthWalletRouter(store));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

async function issueChallenge(
  app: express.Express,
  walletAddress: string
): Promise<{ challengeId: string; challenge: string; expiresAt: string }> {
  const response = await request(app)
    .post("/auth/wallet/challenge")
    .send({ walletAddress })
    .expect(201);
  return response.body;
}

function sign(keypair: Keypair, message: string): string {
  return keypair.sign(Buffer.from(message, "utf8")).toString("base64");
}

describe("POST /auth/wallet/challenge", () => {
  const keypair = Keypair.random();

  beforeEach(() => {
    findOneMock.mockReset();
  });

  it("issues a challenge bound to the requested wallet with a bounded lifetime", async () => {
    const response = await request(createApp())
      .post("/auth/wallet/challenge")
      .send({ walletAddress: keypair.publicKey() })
      .expect(201);

    expect(response.body.challengeId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(response.body.walletAddress).toBe(keypair.publicKey());
    expect(response.body.challenge).toContain(keypair.publicKey());
    expect(response.body.challenge).toMatch(/Nonce: [A-Za-z0-9_-]{40,}/);
    expect(response.body.expiresInSeconds).toBe(300);
    expect(new Date(response.body.expiresAt).getTime()).toBeGreaterThan(
      new Date(response.body.issuedAt).getTime()
    );
    // No token is handed out before a signature is verified.
    expect(response.body.token).toBeUndefined();
  });

  it("rejects a missing wallet address", async () => {
    const response = await request(createApp()).post("/auth/wallet/challenge").send({}).expect(400);

    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a malformed or non-Stellar wallet address", async () => {
    await request(createApp())
      .post("/auth/wallet/challenge")
      .send({ walletAddress: "not-a-wallet" })
      .expect(400);

    await request(createApp())
      .post("/auth/wallet/challenge")
      .send({ walletAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHX" })
      .expect(400);
  });

  it("issues independent single-use challenges, so a retry never reuses state", async () => {
    const app = createApp();
    const first = await issueChallenge(app, keypair.publicKey());
    const second = await issueChallenge(app, keypair.publicKey());

    expect(first.challengeId).not.toBe(second.challengeId);
    expect(first.challenge).not.toBe(second.challenge);
  });
});

describe("POST /auth/wallet/verify", () => {
  let keypair: Keypair;

  beforeEach(() => {
    keypair = Keypair.random();
    findOneMock.mockReset();
  });

  it("verifies a valid signature and issues a JWT for the wallet", async () => {
    const app = createApp();
    const user = makeUser(keypair.publicKey());
    findOneMock.mockResolvedValue(user);

    const challenge = await issueChallenge(app, keypair.publicKey());
    const signature = sign(keypair, challenge.challenge);

    const response = await request(app)
      .post("/auth/wallet/verify")
      .send({
        walletAddress: keypair.publicKey(),
        challengeId: challenge.challengeId,
        signature,
      })
      .expect(200);

    expect(response.body.walletAddress).toBe(keypair.publicKey());
    expect(response.body.id).toBe(user.id);
    expect(typeof response.body.token).toBe("string");

    const decoded = verifyToken(response.body.token);
    expect(decoded?.walletAddress).toBe(keypair.publicKey());
    expect(decoded?.sv).toBe(3);
  });

  it("rejects a replayed challenge after the first successful verification", async () => {
    const app = createApp();
    findOneMock.mockResolvedValue(makeUser(keypair.publicKey()));

    const challenge = await issueChallenge(app, keypair.publicKey());
    const body = {
      walletAddress: keypair.publicKey(),
      challengeId: challenge.challengeId,
      signature: sign(keypair, challenge.challenge),
    };

    await request(app).post("/auth/wallet/verify").send(body).expect(200);

    const replay = await request(app).post("/auth/wallet/verify").send(body).expect(401);
    expect(replay.body.code).toBe("WALLET_CHALLENGE_UNKNOWN");
    expect(replay.body.token).toBeUndefined();
    // One user lookup only: the replay failed before touching the database.
    expect(findOneMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an expired challenge without issuing a token", async () => {
    let nowMs = Date.now();
    const app = createApp(new WalletChallengeStore(1_000, () => nowMs));
    findOneMock.mockResolvedValue(makeUser(keypair.publicKey()));

    const challenge = await issueChallenge(app, keypair.publicKey());
    nowMs += 1_001;

    const response = await request(app)
      .post("/auth/wallet/verify")
      .send({
        walletAddress: keypair.publicKey(),
        challengeId: challenge.challengeId,
        signature: sign(keypair, challenge.challenge),
      })
      .expect(401);

    expect(response.body.code).toBe("WALLET_CHALLENGE_EXPIRED");
    expect(findOneMock).not.toHaveBeenCalled();
  });

  it("rejects a challenge issued for a different wallet even when the other wallet signs it", async () => {
    const app = createApp();
    const otherWallet = Keypair.random();
    findOneMock.mockResolvedValue(makeUser(otherWallet.publicKey()));

    const challenge = await issueChallenge(app, keypair.publicKey());

    const response = await request(app)
      .post("/auth/wallet/verify")
      .send({
        walletAddress: otherWallet.publicKey(),
        challengeId: challenge.challengeId,
        signature: sign(otherWallet, challenge.challenge),
      })
      .expect(401);

    expect(response.body.code).toBe("WALLET_CHALLENGE_WALLET_MISMATCH");
    expect(findOneMock).not.toHaveBeenCalled();
  });

  it("rejects a signature produced by a key that does not own the wallet", async () => {
    const app = createApp();
    const attacker = Keypair.random();
    findOneMock.mockResolvedValue(makeUser(keypair.publicKey()));

    const challenge = await issueChallenge(app, keypair.publicKey());

    const response = await request(app)
      .post("/auth/wallet/verify")
      .send({
        walletAddress: keypair.publicKey(),
        challengeId: challenge.challengeId,
        signature: sign(attacker, challenge.challenge),
      })
      .expect(401);

    expect(response.body.code).toBe("WALLET_CHALLENGE_INVALID_SIGNATURE");
    expect(response.body.token).toBeUndefined();
    expect(findOneMock).not.toHaveBeenCalled();
  });

  it("keeps the challenge usable after a failed signature attempt", async () => {
    const app = createApp();
    findOneMock.mockResolvedValue(makeUser(keypair.publicKey()));
    const challenge = await issueChallenge(app, keypair.publicKey());

    await request(app)
      .post("/auth/wallet/verify")
      .send({
        walletAddress: keypair.publicKey(),
        challengeId: challenge.challengeId,
        signature: sign(Keypair.random(), challenge.challenge),
      })
      .expect(401);

    await request(app)
      .post("/auth/wallet/verify")
      .send({
        walletAddress: keypair.publicKey(),
        challengeId: challenge.challengeId,
        signature: sign(keypair, challenge.challenge),
      })
      .expect(200);
  });

  it("rejects a signature over a different message", async () => {
    const app = createApp();
    const challenge = await issueChallenge(app, keypair.publicKey());

    const response = await request(app)
      .post("/auth/wallet/verify")
      .send({
        walletAddress: keypair.publicKey(),
        challengeId: challenge.challengeId,
        signature: sign(keypair, `${challenge.challenge} `),
      })
      .expect(401);

    expect(response.body.code).toBe("WALLET_CHALLENGE_INVALID_SIGNATURE");
  });

  it("rejects malformed signatures without throwing", async () => {
    const app = createApp();
    const challenge = await issueChallenge(app, keypair.publicKey());

    for (const signature of ["not-base64!!", "", Buffer.alloc(32).toString("base64")]) {
      const response = await request(app).post("/auth/wallet/verify").send({
        walletAddress: keypair.publicKey(),
        challengeId: challenge.challengeId,
        signature,
      });

      // Empty strings fail schema validation (400); the rest fail verification (401).
      expect([400, 401]).toContain(response.status);
      if (response.status === 401) {
        expect(response.body.code).toBe("WALLET_CHALLENGE_INVALID_SIGNATURE");
      }
      expect(response.body.token).toBeUndefined();
    }
  });

  it("rejects an unknown challenge id", async () => {
    const app = createApp();

    const response = await request(app)
      .post("/auth/wallet/verify")
      .send({
        walletAddress: keypair.publicKey(),
        challengeId: "11111111-1111-4111-8111-111111111111",
        signature: Buffer.alloc(64).toString("base64"),
      })
      .expect(401);

    expect(response.body.code).toBe("WALLET_CHALLENGE_UNKNOWN");
  });

  it("rejects a malformed challenge id before verification", async () => {
    const app = createApp();

    const response = await request(app)
      .post("/auth/wallet/verify")
      .send({
        walletAddress: keypair.publicKey(),
        challengeId: "not-a-uuid",
        signature: Buffer.alloc(64).toString("base64"),
      })
      .expect(400);

    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("does not issue a token for an unregistered, inactive, or deleted wallet", async () => {
    const app = createApp();
    const challenge = await issueChallenge(app, keypair.publicKey());
    const body = {
      walletAddress: keypair.publicKey(),
      challengeId: challenge.challengeId,
      signature: sign(keypair, challenge.challenge),
    };

    findOneMock.mockResolvedValue(null);
    const missing = await request(app).post("/auth/wallet/verify").send(body).expect(401);
    expect(missing.body.code).toBe("UNAUTHORIZED");
    expect(missing.body.token).toBeUndefined();

    const second = await issueChallenge(app, keypair.publicKey());
    findOneMock.mockResolvedValue(makeUser(keypair.publicKey(), { isActive: false }));
    const inactive = await request(app)
      .post("/auth/wallet/verify")
      .send({
        ...body,
        challengeId: second.challengeId,
        signature: sign(keypair, second.challenge),
      })
      .expect(401);
    expect(inactive.body.token).toBeUndefined();

    const third = await issueChallenge(app, keypair.publicKey());
    findOneMock.mockResolvedValue(null);
    const deleted = await request(app)
      .post("/auth/wallet/verify")
      .send({ ...body, challengeId: third.challengeId, signature: sign(keypair, third.challenge) })
      .expect(401);
    expect(deleted.body.token).toBeUndefined();
  });

  it("fails closed when the account lookup throws", async () => {
    const app = createApp();
    findOneMock.mockRejectedValue(new Error("database unavailable"));
    const challenge = await issueChallenge(app, keypair.publicKey());

    const response = await request(app)
      .post("/auth/wallet/verify")
      .send({
        walletAddress: keypair.publicKey(),
        challengeId: challenge.challengeId,
        signature: sign(keypair, challenge.challenge),
      })
      .expect(500);

    expect(response.body.error).toBe("internal_error");
    expect(response.body.stack).toBeUndefined();
  });
});
