import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { runDatabaseConsistencyAudit } from "./audit-database-consistency.js";
import { maskWalletAddress } from "./check-orphaned-transactions.js";
import { User } from "../entities/User.js";
import { TransactionRecord } from "../entities/Transaction.js";
import { LedgerBlock } from "../entities/LedgerBlock.js";
import { Notification } from "../entities/Notification.js";
import { NotificationPreference } from "../entities/NotificationPreference.js";
import { SplitCancellation } from "../entities/SplitCancellation.js";

// Mocked-repository unit test, not a live-DB integration test — same
// rationale as check-orphaned-transactions.test.ts: the audit only ever
// calls repo.find(), so a plain object with a mocked `find` per entity fully
// exercises the real detection logic without a live Postgres connection.

const WALLET_A = "GA111111111111111111111111111111111111111111111111AAAA";
const WALLET_B = "GB222222222222222222222222222222222222222222222222BBBB";

interface FixtureData {
  users?: User[];
  transactions?: TransactionRecord[];
  ledgerBlocks?: LedgerBlock[];
  notifications?: Notification[];
  notificationPreferences?: NotificationPreference[];
  splitCancellations?: SplitCancellation[];
}

function makeUser(overrides: Partial<User>): User {
  return { id: "user-1", walletAddress: WALLET_A, role: "user", isActive: true, ...overrides } as User;
}

function makeTransaction(overrides: Partial<TransactionRecord>): TransactionRecord {
  return {
    id: "tx-1",
    roundId: "round-1",
    recipient: WALLET_A,
    amount: "1000",
    token: "native",
    timestamp: 1732012800,
    txHash: "hash-1",
    status: "completed",
    ...overrides,
  } as TransactionRecord;
}

function makeLedgerBlock(overrides: Partial<LedgerBlock>): LedgerBlock {
  return {
    id: "block-1",
    ledgerSeq: 100,
    txHash: "hash-1",
    type: "settlement",
    projectId: "project-1",
    recipient: WALLET_A,
    amount: "1000",
    ledgerClosedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as LedgerBlock;
}

function makeNotification(overrides: Partial<Notification>): Notification {
  return {
    id: "notif-1",
    recipient: WALLET_A,
    category: "system",
    title: "t",
    body: "b",
    eventKey: "event-1",
    source: "api",
    resourceType: null,
    resourceId: null,
    metadata: null,
    readAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as Notification;
}

function makePreference(overrides: Partial<NotificationPreference>): NotificationPreference {
  return {
    id: "pref-1",
    wallet: WALLET_A,
    category: "project_activity",
    enabled: true,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as NotificationPreference;
}

function makeSplitCancellation(overrides: Partial<SplitCancellation>): SplitCancellation {
  return {
    id: "cancel-1",
    projectId: "project-1",
    cancelledBy: WALLET_A,
    reason: null,
    cancelledAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as SplitCancellation;
}

function buildMockDataSource(fixture: FixtureData): DataSource {
  const repos = new Map<unknown, { find: ReturnType<typeof vi.fn> }>([
    [User, { find: vi.fn().mockResolvedValue(fixture.users ?? []) }],
    [TransactionRecord, { find: vi.fn().mockResolvedValue(fixture.transactions ?? []) }],
    [LedgerBlock, { find: vi.fn().mockResolvedValue(fixture.ledgerBlocks ?? []) }],
    [Notification, { find: vi.fn().mockResolvedValue(fixture.notifications ?? []) }],
    [
      NotificationPreference,
      { find: vi.fn().mockResolvedValue(fixture.notificationPreferences ?? []) },
    ],
    [SplitCancellation, { find: vi.fn().mockResolvedValue(fixture.splitCancellations ?? []) }],
  ]);

  return {
    getRepository: vi.fn().mockImplementation((entity: unknown) => {
      const repo = repos.get(entity);
      if (!repo) throw new Error("Unexpected entity requested from mock DataSource");
      return repo;
    }),
  } as unknown as DataSource;
}

/** A fully self-consistent fixture: every check should pass against this. */
function cleanFixture(): FixtureData {
  return {
    users: [makeUser({ walletAddress: WALLET_A })],
    transactions: [makeTransaction({ txHash: "hash-1", status: "completed", recipient: WALLET_A })],
    ledgerBlocks: [makeLedgerBlock({ txHash: "hash-1", type: "settlement", recipient: WALLET_A })],
    notifications: [makeNotification({ eventKey: "event-1" })],
    notificationPreferences: [
      makePreference({ wallet: WALLET_A, category: "security", enabled: true }),
    ],
    splitCancellations: [makeSplitCancellation({ projectId: "project-1" })],
  };
}

describe("runDatabaseConsistencyAudit", () => {
  it("reports ok=true with no findings when the database is fully consistent", async () => {
    const dataSource = buildMockDataSource(cleanFixture());

    const report = await runDatabaseConsistencyAudit(dataSource);

    expect(report.ok).toBe(true);
    expect(report.findings).toHaveLength(0);
    expect(report.checksRun).toContain("transaction-ledger-reconciliation");
    expect(report.checksRun).toContain("duplicate-wallet-address");
    expect(typeof report.generatedAt).toBe("string");
  });

  it("propagates a critical finding from the orphaned-transaction reconciliation and marks the report not ok", async () => {
    const fixture = cleanFixture();
    fixture.transactions = [
      makeTransaction({ id: "tx-orphan", txHash: "hash-missing", status: "completed" }),
    ];
    fixture.ledgerBlocks = [];
    const dataSource = buildMockDataSource(fixture);

    const report = await runDatabaseConsistencyAudit(dataSource);

    expect(report.ok).toBe(false);
    const finding = report.findings.find(
      (f) => f.checkId === "transaction-ledger-reconciliation" && f.severity === "critical"
    );
    expect(finding).toBeDefined();
    expect(finding?.sampleIds).toEqual(["hash-missing"]);
  });

  it("does not fail the report for warning-only findings (e.g. unregistered recipients)", async () => {
    const fixture = cleanFixture();
    fixture.users = []; // recipient WALLET_A is now "unregistered" -> warning only
    const dataSource = buildMockDataSource(fixture);

    const report = await runDatabaseConsistencyAudit(dataSource);

    expect(report.ok).toBe(true);
    expect(
      report.findings.some(
        (f) => f.checkId === "transaction-ledger-reconciliation" && f.severity === "warning"
      )
    ).toBe(true);
  });

  it("flags a wallet address registered on more than one users row, masked", async () => {
    const fixture = cleanFixture();
    fixture.users = [
      makeUser({ id: "u1", walletAddress: WALLET_B }),
      makeUser({ id: "u2", walletAddress: WALLET_B }),
    ];
    const dataSource = buildMockDataSource(fixture);

    const report = await runDatabaseConsistencyAudit(dataSource);

    const finding = report.findings.find((f) => f.checkId === "duplicate-wallet-address");
    expect(finding).toMatchObject({ severity: "critical", count: 1 });
    expect(finding?.sampleIds).toEqual([maskWalletAddress(WALLET_B)]);
    expect(finding?.sampleIds?.[0]).not.toBe(WALLET_B);
    expect(report.ok).toBe(false);
  });

  it("flags a txHash appearing on more than one transactions row", async () => {
    const fixture = cleanFixture();
    fixture.transactions = [
      makeTransaction({ id: "tx-1", txHash: "dupe-hash" }),
      makeTransaction({ id: "tx-2", txHash: "dupe-hash" }),
    ];
    fixture.ledgerBlocks = [makeLedgerBlock({ txHash: "dupe-hash" })];
    const dataSource = buildMockDataSource(fixture);

    const report = await runDatabaseConsistencyAudit(dataSource);

    const finding = report.findings.find((f) => f.checkId === "duplicate-transaction-hash");
    expect(finding).toMatchObject({ severity: "critical", count: 1, sampleIds: ["dupe-hash"] });
    expect(report.ok).toBe(false);
  });

  it("flags a notification eventKey appearing on more than one row", async () => {
    const fixture = cleanFixture();
    fixture.notifications = [
      makeNotification({ id: "n1", eventKey: "dupe-event" }),
      makeNotification({ id: "n2", eventKey: "dupe-event" }),
    ];
    const dataSource = buildMockDataSource(fixture);

    const report = await runDatabaseConsistencyAudit(dataSource);

    const finding = report.findings.find(
      (f) => f.checkId === "duplicate-notification-event-key"
    );
    expect(finding).toMatchObject({ severity: "critical", count: 1, sampleIds: ["dupe-event"] });
  });

  it("flags a (wallet, category) pair appearing on more than one notification_preferences row, masking the wallet", async () => {
    const fixture = cleanFixture();
    fixture.notificationPreferences = [
      makePreference({ id: "p1", wallet: WALLET_B, category: "marketing" }),
      makePreference({ id: "p2", wallet: WALLET_B, category: "marketing" }),
    ];
    const dataSource = buildMockDataSource(fixture);

    const report = await runDatabaseConsistencyAudit(dataSource);

    const finding = report.findings.find(
      (f) => f.checkId === "duplicate-notification-preference"
    );
    expect(finding).toMatchObject({ severity: "critical", count: 1 });
    expect(finding?.sampleIds).toEqual([`${maskWalletAddress(WALLET_B)}::marketing`]);
  });

  it("flags a project id appearing on more than one split_cancellations row", async () => {
    const fixture = cleanFixture();
    fixture.splitCancellations = [
      makeSplitCancellation({ id: "c1", projectId: "dupe-project" }),
      makeSplitCancellation({ id: "c2", projectId: "dupe-project" }),
    ];
    const dataSource = buildMockDataSource(fixture);

    const report = await runDatabaseConsistencyAudit(dataSource);

    const finding = report.findings.find(
      (f) => f.checkId === "duplicate-split-cancellation-project"
    );
    expect(finding).toMatchObject({
      severity: "critical",
      count: 1,
      sampleIds: ["dupe-project"],
    });
  });

  it("flags a mandatory (security/payment) preference that is disabled", async () => {
    const fixture = cleanFixture();
    fixture.notificationPreferences = [
      makePreference({ wallet: WALLET_B, category: "security", enabled: false }),
    ];
    const dataSource = buildMockDataSource(fixture);

    const report = await runDatabaseConsistencyAudit(dataSource);

    const finding = report.findings.find(
      (f) => f.checkId === "mandatory-notification-preference-disabled"
    );
    expect(finding).toMatchObject({ severity: "critical", count: 1 });
    expect(finding?.sampleIds).toEqual([`${maskWalletAddress(WALLET_B)}::security`]);
    expect(report.ok).toBe(false);
  });

  it("does not flag a disabled optional (non-mandatory) preference category", async () => {
    const fixture = cleanFixture();
    fixture.notificationPreferences = [
      makePreference({ wallet: WALLET_A, category: "marketing", enabled: false }),
    ];
    const dataSource = buildMockDataSource(fixture);

    const report = await runDatabaseConsistencyAudit(dataSource);

    expect(
      report.findings.some((f) => f.checkId === "mandatory-notification-preference-disabled")
    ).toBe(false);
    expect(report.ok).toBe(true);
  });
});