/**
 * Signed wallet challenge authentication (Issue #1232).
 *
 * `POST /users/login` historically treated a public Stellar address as proof
 * of identity: anyone who knew (or guessed) a wallet address could obtain a
 * JWT for it. This module implements the missing half of the flow — a
 * short-lived, single-use challenge that the wallet must sign with the
 * Ed25519 key behind its Stellar account, so the server sees cryptographic
 * proof of ownership before it mints a token.
 *
 * Storage mirrors `services/login-attempts.ts` and `services/idempotency.ts`:
 * a bounded, per-process map rather than a Postgres table. Challenges live for
 * minutes, are useless after a single successful verification, and are cheap
 * to re-issue, so a migration and a database round-trip on the hottest auth
 * path would add cost without a matching reliability benefit. The trade-off is
 * the same as those stores: a challenge issued by one instance is unknown to
 * another, so a deployment must either keep auth traffic sticky for the
 * challenge's lifetime or front this store with a shared cache.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { Keypair, StrKey } from "@stellar/stellar-sdk";

/** Domain separator included in every signed message (cross-site replay guard). */
export const WALLET_CHALLENGE_DOMAIN = "splitnaira.com";

/** Default lifetime of an issued challenge. */
export const DEFAULT_WALLET_CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** Upper bound on retained challenges, so unauthenticated traffic cannot grow the map without limit. */
export const DEFAULT_WALLET_CHALLENGE_CAPACITY = 10_000;

/** Base64-encoded Ed25519 signatures are 64 bytes -> 88 base64 characters with padding. */
const ED25519_SIGNATURE_BYTES = 64;

export interface WalletChallenge {
  challengeId: string;
  walletAddress: string;
  /** Exact UTF-8 message the wallet must sign. */
  challenge: string;
  issuedAt: string;
  expiresAt: string;
}

export type WalletChallengeFailureReason =
  | "unknown"
  | "expired"
  | "wallet_mismatch"
  | "invalid_signature";

export type WalletChallengeResult =
  | { ok: true; challenge: WalletChallenge }
  | { ok: false; reason: WalletChallengeFailureReason };

interface StoredChallenge extends WalletChallenge {
  expiresAtMs: number;
}

export interface WalletChallengeVerificationInput {
  challengeId: string;
  walletAddress: string;
  /** Base64-encoded Ed25519 signature over the UTF-8 challenge string. */
  signature: string;
}

/**
 * Canonical, human-readable message the wallet signs.
 *
 * Every line is labelled and values cannot contain newlines (address is
 * base32, nonce is base64url, timestamps are ISO-8601), so a wallet's signing
 * UI shows something unambiguous while the server can re-derive an exact,
 * byte-for-byte match from stored state.
 */
export function buildWalletChallengeMessage(input: {
  walletAddress: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}): string {
  return [
    `${WALLET_CHALLENGE_DOMAIN} wants you to sign in with your Stellar account:`,
    input.walletAddress,
    "",
    "This request proves you control this wallet. It does not move funds or grant spending rights.",
    "",
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
    `Expires At: ${input.expiresAt}`,
  ].join("\n");
}

/**
 * Verifies an Ed25519 signature from the Stellar account itself.
 *
 * Returns `false` for anything that is not a well-formed 64-byte signature
 * over the challenge, including malformed base64, a truncated buffer, a key
 * that is not an Ed25519 account, or a signature produced by a different key.
 */
export function verifyWalletChallengeSignature(
  challenge: string,
  walletAddress: string,
  signature: string
): boolean {
  try {
    if (!StrKey.isValidEd25519PublicKey(walletAddress)) {
      return false;
    }

    const signatureBytes = Buffer.from(signature, "base64");
    if (signatureBytes.length !== ED25519_SIGNATURE_BYTES) {
      return false;
    }

    return Keypair.fromPublicKey(walletAddress).verify(
      Buffer.from(challenge, "utf8"),
      signatureBytes
    );
  } catch {
    return false;
  }
}

export class WalletChallengeStore {
  private readonly entries = new Map<string, StoredChallenge>();

  constructor(
    private readonly ttlMs: number = DEFAULT_WALLET_CHALLENGE_TTL_MS,
    private readonly now: () => number = () => Date.now(),
    private readonly capacity: number = DEFAULT_WALLET_CHALLENGE_CAPACITY
  ) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new RangeError("Wallet challenge TTL must be a positive number of milliseconds.");
    }
  }

  get size(): number {
    return this.entries.size;
  }

  /** Issues a fresh challenge for a Stellar account address. */
  issue(walletAddress: string): WalletChallenge {
    if (!StrKey.isValidEd25519PublicKey(walletAddress)) {
      throw new RangeError("Cannot issue a wallet challenge for an invalid Stellar address.");
    }

    this.purgeExpired();

    // Preserve room for new challenges without ever evicting a live one:
    // expire first, then drop the oldest entry, which is closest to expiry.
    while (this.entries.size >= this.capacity) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }

    const issuedAtMs = this.now();
    const expiresAtMs = issuedAtMs + this.ttlMs;
    const issuedAt = new Date(issuedAtMs).toISOString();
    const expiresAt = new Date(expiresAtMs).toISOString();
    const nonce = randomBytes(32).toString("base64url");
    const challenge = buildWalletChallengeMessage({ walletAddress, nonce, issuedAt, expiresAt });

    const record: StoredChallenge = {
      challengeId: randomUUID(),
      walletAddress,
      challenge,
      issuedAt,
      expiresAt,
      expiresAtMs,
    };
    this.entries.set(record.challengeId, record);

    return {
      challengeId: record.challengeId,
      walletAddress: record.walletAddress,
      challenge: record.challenge,
      issuedAt: record.issuedAt,
      expiresAt: record.expiresAt,
    };
  }

  /**
   * Validates a signature and consumes the challenge atomically on success.
   *
   * A failed signature does NOT consume the challenge: a user who mistypes or
   * a wallet that signs the wrong thing can retry until the challenge expires.
   * A successful verification deletes the record before returning, so the
   * same challenge can never mint a second JWT (replay protection).
   */
  verifyAndConsume(input: WalletChallengeVerificationInput): WalletChallengeResult {
    const record = this.entries.get(input.challengeId);
    if (!record) {
      return { ok: false, reason: "unknown" };
    }

    if (record.expiresAtMs <= this.now()) {
      this.entries.delete(input.challengeId);
      return { ok: false, reason: "expired" };
    }

    if (record.walletAddress !== input.walletAddress) {
      return { ok: false, reason: "wallet_mismatch" };
    }

    if (!verifyWalletChallengeSignature(record.challenge, record.walletAddress, input.signature)) {
      return { ok: false, reason: "invalid_signature" };
    }

    this.entries.delete(input.challengeId);

    return {
      ok: true,
      challenge: {
        challengeId: record.challengeId,
        walletAddress: record.walletAddress,
        challenge: record.challenge,
        issuedAt: record.issuedAt,
        expiresAt: record.expiresAt,
      },
    };
  }

  /** Drops every challenge whose lifetime has elapsed. */
  purgeExpired(): void {
    const now = this.now();
    for (const [challengeId, record] of this.entries) {
      if (record.expiresAtMs <= now) {
        this.entries.delete(challengeId);
      }
    }
  }

  /** Test helper: drop all issued challenges. */
  clear(): void {
    this.entries.clear();
  }
}

const configuredTtlMs = Number(process.env.WALLET_CHALLENGE_TTL_MS);

export const walletChallengeStore = new WalletChallengeStore(
  Number.isFinite(configuredTtlMs) && configuredTtlMs > 0
    ? configuredTtlMs
    : DEFAULT_WALLET_CHALLENGE_TTL_MS
);
