import { describe, expect, it } from "vitest";
import { StrKey } from "@stellar/stellar-sdk";
import {
  SEED_PROJECT_IDS,
  SEED_WALLETS,
  buildDevelopmentSeed,
  seedTxHash,
  seedUuid,
  summarizeSeed,
} from "./seed-development-data.js";
import { SeedSafetyError, assertSafeToSeed } from "./seed-development.js";
import { TRANSACTION_STATUSES } from "../entities/Transaction.js";
import { USER_ROLES } from "../lib/user-roles.js";
import { PREFERENCE_CATEGORIES, isMandatoryCategory } from "../entities/NotificationPreference.js";
import { NOTIFICATION_CATEGORIES } from "../entities/Notification.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function duplicates(values: string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) !== index);
}

describe("development seed data (#1342)", () => {
  const seed = buildDevelopmentSeed();

  it("is deterministic: two builds are identical", () => {
    expect(JSON.stringify(buildDevelopmentSeed())).toBe(JSON.stringify(seed));
  });

  it("derives stable, well-formed ids", () => {
    expect(seedUuid("a")).toBe(seedUuid("a"));
    expect(seedUuid("a")).not.toBe(seedUuid("b"));
    expect(seedUuid("a")).toMatch(UUID_V4);
    expect(seedTxHash("a")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("uses only valid Stellar addresses", () => {
    for (const wallet of Object.values(SEED_WALLETS)) {
      expect(StrKey.isValidEd25519PublicKey(wallet)).toBe(true);
    }
  });

  it("uses only reserved example.com email addresses", () => {
    for (const user of seed.users) {
      expect(user.email.endsWith("@example.com")).toBe(true);
    }
  });

  it("covers every transaction status", () => {
    const seen = new Set(seed.transactions.map((t) => t.status));
    for (const status of TRANSACTION_STATUSES) {
      expect(seen.has(status)).toBe(true);
    }
    const summary = summarizeSeed(seed);
    expect(summary.transactionsByStatus.completed).toBeGreaterThan(0);
    expect(summary.transactionsByStatus.pending).toBeGreaterThan(0);
    expect(summary.transactionsByStatus.failed).toBeGreaterThan(0);
  });

  it("includes active and inactive users with valid roles", () => {
    expect(seed.users.some((u) => u.isActive)).toBe(true);
    expect(seed.users.some((u) => !u.isActive)).toBe(true);
    for (const user of seed.users) {
      expect(USER_ROLES).toContain(user.role);
    }
  });

  it("has three projects whose participant shares sum to 100%", () => {
    expect(seed.projects.map((p) => p.projectId).sort()).toEqual(
      Object.values(SEED_PROJECT_IDS).sort()
    );
    for (const project of seed.projects) {
      const total = project.participants.reduce((sum, p) => sum + p.shareBps, 0);
      expect(total).toBe(10000);
    }
  });

  it("never pays out more than a project's total", () => {
    for (const project of seed.projects) {
      const paid = seed.transactions
        .filter((t) => t.roundId === project.projectId)
        .reduce((sum, t) => sum + BigInt(t.amount), 0n);
      expect(paid <= BigInt(project.totalAmount)).toBe(true);
    }
  });

  it("creates one transaction per project participant", () => {
    const expected = seed.projects.reduce((n, p) => n + p.participants.length, 0);
    expect(seed.transactions).toHaveLength(expected);
  });

  it("has unique primary keys and unique natural keys", () => {
    const tables = [
      seed.users,
      seed.transactions,
      seed.ledgerBlocks,
      seed.notificationPreferences,
      seed.notifications,
      seed.splitCancellations,
      seed.projectEdits,
    ];
    for (const rows of tables) {
      expect(duplicates(rows.map((r) => r.id))).toEqual([]);
    }
    expect(duplicates(seed.users.map((u) => u.walletAddress))).toEqual([]);
    expect(duplicates(seed.transactions.map((t) => t.txHash))).toEqual([]);
    expect(duplicates(seed.splitCancellations.map((c) => c.projectId))).toEqual([]);
    // The consistency audit (#1338) requires eventKey to be unique globally.
    expect(duplicates(seed.notifications.map((n) => n.eventKey))).toEqual([]);
    expect(
      duplicates(seed.notificationPreferences.map((p) => `${p.wallet}:${p.category}`))
    ).toEqual([]);
  });

  it("keeps transactions and settlement blocks reconciled", () => {
    const completed = seed.transactions.filter((t) => t.status === "completed");
    const blockHashes = seed.ledgerBlocks.map((b) => b.txHash).sort();
    expect(blockHashes).toEqual(completed.map((t) => t.txHash).sort());
    for (const block of seed.ledgerBlocks) {
      const tx = seed.transactions.find((t) => t.txHash === block.txHash);
      expect(tx?.recipient).toBe(block.recipient);
      expect(tx?.amount).toBe(block.amount);
      expect(tx?.roundId).toBe(block.projectId);
    }
  });

  it("includes a recipient who is not a registered user", () => {
    const registered = new Set(seed.users.map((u) => u.walletAddress));
    const recipients = new Set(seed.transactions.map((t) => t.recipient));
    expect([...recipients].some((r) => !registered.has(r))).toBe(true);
  });

  it("never disables a mandatory notification preference", () => {
    for (const pref of seed.notificationPreferences) {
      expect(PREFERENCE_CATEGORIES).toContain(pref.category);
      if (isMandatoryCategory(pref.category)) expect(pref.enabled).toBe(true);
    }
  });

  it("seeds read and unread notifications in valid categories", () => {
    for (const n of seed.notifications) {
      expect(NOTIFICATION_CATEGORIES).toContain(n.category);
      expect(n.title.length).toBeLessThanOrEqual(200);
      expect(n.body.length).toBeLessThanOrEqual(1000);
      expect(n.eventKey.length).toBeLessThanOrEqual(200);
    }
    expect(seed.notifications.some((n) => n.readAt !== null)).toBe(true);
    expect(seed.notifications.some((n) => n.readAt === null)).toBe(true);
  });

  it("cancels exactly the cancelled project, by its owner", () => {
    const cancelled = seed.projects.filter((p) => p.cancelled);
    expect(seed.splitCancellations.map((c) => c.projectId)).toEqual(
      cancelled.map((p) => p.projectId)
    );
    for (const c of seed.splitCancellations) {
      expect(c.cancelledBy).toBe(SEED_WALLETS.owner);
    }
  });

  it("respects column length limits", () => {
    for (const t of seed.transactions) {
      expect(t.roundId.length).toBeLessThanOrEqual(64);
      expect(t.amount.length).toBeLessThanOrEqual(64);
    }
    for (const e of seed.projectEdits) {
      expect(e.projectId.length).toBeLessThanOrEqual(64);
    }
  });
});

describe("assertSafeToSeed", () => {
  const local = "postgresql://u:p@localhost:5432/db";

  it("allows a local development database", () => {
    expect(() => assertSafeToSeed({ NODE_ENV: "development", DATABASE_URL: local })).not.toThrow();
    expect(() =>
      assertSafeToSeed({ DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/db" })
    ).not.toThrow();
    expect(() =>
      assertSafeToSeed({ DATABASE_URL: "postgresql://u:p@postgres:5432/db" })
    ).not.toThrow();
  });

  it("refuses production", () => {
    expect(() => assertSafeToSeed({ NODE_ENV: "production", DATABASE_URL: local })).toThrow(
      SeedSafetyError
    );
  });

  it("refuses a missing or malformed DATABASE_URL", () => {
    expect(() => assertSafeToSeed({})).toThrow(SeedSafetyError);
    expect(() => assertSafeToSeed({ DATABASE_URL: "not a url" })).toThrow(SeedSafetyError);
  });

  it("refuses a remote host unless explicitly overridden", () => {
    const remote = "postgresql://u:p@db.example.org:5432/db";
    expect(() => assertSafeToSeed({ DATABASE_URL: remote })).toThrow(/non-local/);
    expect(() =>
      assertSafeToSeed({ DATABASE_URL: remote, SEED_ALLOW_REMOTE_DB: "true" })
    ).not.toThrow();
  });

  it("still refuses production even with the remote override", () => {
    expect(() =>
      assertSafeToSeed({
        NODE_ENV: "production",
        DATABASE_URL: local,
        SEED_ALLOW_REMOTE_DB: "true",
      })
    ).toThrow(SeedSafetyError);
  });
});
