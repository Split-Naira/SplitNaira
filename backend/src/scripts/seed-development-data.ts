/**
 * Deterministic development seed data (#1342).
 *
 * This module is pure: it builds plain objects and never touches a database,
 * the network or the clock, so calling it twice always returns identical data.
 * `seed-development.ts` is the part that writes it to Postgres.
 *
 * Safety:
 *   - Wallet addresses are valid Stellar public keys built from repeated
 *     filler bytes. They are not derived from any secret key, so nobody
 *     controls them and no funds can ever move.
 *   - Emails use the reserved `example.com` domain.
 *   - Every id (uuid, tx hash) is derived from a fixed label with SHA-256,
 *     so re-running the seed produces the same rows instead of new ones.
 *
 * What "projects" and "participants" mean here: SplitNaira keeps projects on
 * chain (Soroban) and has no local projects table (see
 * docs/foreign-key-integrity-audit.md). A seeded project is therefore a
 * project id that the database rows point at, and a participant is a wallet
 * that receives a payout. Three projects cover three lifecycle states:
 *
 *   dev_seed_album_split   fully distributed (every payout completed)
 *   dev_seed_film_split    in flight (completed, pending and failed payouts)
 *   dev_seed_cancelled     cancelled (failed payouts and a cancellation row)
 */
import { createHash } from "node:crypto";
import type { UserRole } from "../lib/user-roles.js";
import type { TransactionStatus } from "../entities/Transaction.js";
import type { NotificationCategory } from "../entities/Notification.js";
import type { PreferenceCategory } from "../entities/NotificationPreference.js";

/** 2026-01-01T00:00:00Z. Every seeded timestamp is an offset from this. */
export const SEED_EPOCH_SECONDS = 1767225600;

const HOUR = 3600;

export const SEED_TOKEN = "native";

// Valid Stellar public keys made from one repeated filler byte each
// (0x11, 0x22, 0x33, 0x44, 0x55, 0x66). No secret key exists for them.
export const SEED_WALLETS = {
  owner: "GAIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCF6M",
  producer: "GARCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCFRVX",
  vocalist: "GAZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTHCM6",
  engineer: "GBCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIZCA",
  dormant: "GBKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKVKK3J",
  // Receives a payout but is deliberately NOT a registered user: recipients
  // are never required to have an account (see check-orphaned-transactions).
  outsider: "GBTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGN6QS",
} as const;

export const SEED_PROJECT_IDS = {
  album: "dev_seed_album_split",
  film: "dev_seed_film_split",
  cancelled: "dev_seed_cancelled",
} as const;

export interface SeedUser {
  id: string;
  walletAddress: string;
  email: string;
  alias: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SeedTransaction {
  id: string;
  roundId: string;
  recipient: string;
  amount: string;
  token: string;
  timestamp: number;
  txHash: string;
  status: TransactionStatus;
}

export interface SeedLedgerBlock {
  id: string;
  ledgerSeq: number;
  txHash: string;
  type: "settlement";
  projectId: string;
  recipient: string;
  amount: string;
  ledgerClosedAt: Date;
}

export interface SeedNotificationPreference {
  id: string;
  wallet: string;
  category: PreferenceCategory;
  enabled: boolean;
  updatedAt: Date;
}

export interface SeedNotification {
  id: string;
  recipient: string;
  category: NotificationCategory;
  title: string;
  body: string;
  eventKey: string;
  source: string;
  resourceType: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  readAt: Date | null;
  createdAt: Date;
}

export interface SeedSplitCancellation {
  id: string;
  projectId: string;
  cancelledBy: string;
  reason: string;
  cancelledAt: Date;
}

export interface SeedProjectEdit {
  id: string;
  projectId: string;
  actor: string;
  action: string;
  changes: Record<string, unknown>;
  createdAt: Date;
}

export interface SeedParticipant {
  wallet: string;
  /** Share of the project in basis points (10000 = 100%). */
  shareBps: number;
  payoutStatus: TransactionStatus;
}

export interface SeedProject {
  projectId: string;
  title: string;
  owner: string;
  /** Total amount in stroops (1 XLM = 10,000,000 stroops), as a string. */
  totalAmount: string;
  participants: SeedParticipant[];
  cancelled: boolean;
}

export interface DevelopmentSeed {
  users: SeedUser[];
  projects: SeedProject[];
  transactions: SeedTransaction[];
  ledgerBlocks: SeedLedgerBlock[];
  notificationPreferences: SeedNotificationPreference[];
  notifications: SeedNotification[];
  splitCancellations: SeedSplitCancellation[];
  projectEdits: SeedProjectEdit[];
}

/** Deterministic RFC 4122 v4-shaped uuid derived from a label. */
export function seedUuid(label: string): string {
  const bytes = createHash("sha256")
    .update(`splitnaira-dev-seed:${label}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

/** Deterministic 64-character hex transaction hash derived from a label. */
export function seedTxHash(label: string): string {
  return createHash("sha256").update(`splitnaira-dev-seed-tx:${label}`).digest("hex");
}

function at(offsetHours: number): Date {
  return new Date((SEED_EPOCH_SECONDS + offsetHours * HOUR) * 1000);
}

function payoutAmount(totalAmount: string, shareBps: number): string {
  return ((BigInt(totalAmount) * BigInt(shareBps)) / 10000n).toString();
}

const PROJECTS: SeedProject[] = [
  {
    projectId: SEED_PROJECT_IDS.album,
    title: "Seed Album Royalties",
    owner: SEED_WALLETS.owner,
    totalAmount: "10000000000",
    cancelled: false,
    participants: [
      { wallet: SEED_WALLETS.producer, shareBps: 5000, payoutStatus: "completed" },
      { wallet: SEED_WALLETS.vocalist, shareBps: 3000, payoutStatus: "completed" },
      { wallet: SEED_WALLETS.engineer, shareBps: 2000, payoutStatus: "completed" },
    ],
  },
  {
    projectId: SEED_PROJECT_IDS.film,
    title: "Seed Short Film Split",
    owner: SEED_WALLETS.owner,
    totalAmount: "4000000000",
    cancelled: false,
    participants: [
      { wallet: SEED_WALLETS.producer, shareBps: 6000, payoutStatus: "completed" },
      { wallet: SEED_WALLETS.outsider, shareBps: 2500, payoutStatus: "pending" },
      { wallet: SEED_WALLETS.engineer, shareBps: 1500, payoutStatus: "failed" },
    ],
  },
  {
    projectId: SEED_PROJECT_IDS.cancelled,
    title: "Seed Cancelled Split",
    owner: SEED_WALLETS.owner,
    totalAmount: "2000000000",
    cancelled: true,
    participants: [
      { wallet: SEED_WALLETS.vocalist, shareBps: 5000, payoutStatus: "failed" },
      { wallet: SEED_WALLETS.engineer, shareBps: 5000, payoutStatus: "failed" },
    ],
  },
];

function buildUsers(): SeedUser[] {
  const rows: Array<Omit<SeedUser, "id" | "createdAt" | "updatedAt"> & { key: string }> = [
    {
      key: "owner",
      walletAddress: SEED_WALLETS.owner,
      email: "seed.owner@example.com",
      alias: "Seed Owner",
      role: "company",
      isActive: true,
    },
    {
      key: "producer",
      walletAddress: SEED_WALLETS.producer,
      email: "seed.producer@example.com",
      alias: "Seed Producer",
      role: "customer",
      isActive: true,
    },
    {
      key: "vocalist",
      walletAddress: SEED_WALLETS.vocalist,
      email: "seed.vocalist@example.com",
      alias: "Seed Vocalist",
      role: "customer",
      isActive: true,
    },
    {
      key: "engineer",
      walletAddress: SEED_WALLETS.engineer,
      email: "seed.engineer@example.com",
      alias: "Seed Engineer",
      role: "customer",
      isActive: true,
    },
    {
      key: "dormant",
      walletAddress: SEED_WALLETS.dormant,
      email: "seed.dormant@example.com",
      alias: "Seed Dormant User",
      role: "customer",
      isActive: false,
    },
  ];

  return rows.map(({ key, ...user }, index) => ({
    id: seedUuid(`user:${key}`),
    ...user,
    createdAt: at(index),
    updatedAt: at(index),
  }));
}

function buildTransactions(): SeedTransaction[] {
  const rows: SeedTransaction[] = [];
  PROJECTS.forEach((project, projectIndex) => {
    project.participants.forEach((participant, participantIndex) => {
      const label = `${project.projectId}:${participant.wallet}`;
      rows.push({
        id: seedUuid(`transaction:${label}`),
        roundId: project.projectId,
        recipient: participant.wallet,
        amount: payoutAmount(project.totalAmount, participant.shareBps),
        token: SEED_TOKEN,
        timestamp: SEED_EPOCH_SECONDS + (24 + projectIndex * 24 + participantIndex) * HOUR,
        txHash: seedTxHash(label),
        status: participant.payoutStatus,
      });
    });
  });
  return rows;
}

function buildLedgerBlocks(transactions: SeedTransaction[]): SeedLedgerBlock[] {
  // Only completed payouts have an on-chain settlement record. A pending or
  // failed payout must NOT have one: the consistency audit treats a
  // settlement block without a matching transaction as a critical drift.
  return transactions
    .filter((tx) => tx.status === "completed")
    .map((tx, index) => ({
      id: seedUuid(`ledger-block:${tx.txHash}`),
      ledgerSeq: 5000000 + index,
      txHash: tx.txHash,
      type: "settlement" as const,
      projectId: tx.roundId,
      recipient: tx.recipient,
      amount: tx.amount,
      ledgerClosedAt: new Date(tx.timestamp * 1000),
    }));
}

function buildNotificationPreferences(): SeedNotificationPreference[] {
  // security and payment are mandatory and must never be disabled.
  const rows: Array<[string, PreferenceCategory, boolean]> = [
    [SEED_WALLETS.owner, "security", true],
    [SEED_WALLETS.owner, "payment", true],
    [SEED_WALLETS.owner, "marketing", false],
    [SEED_WALLETS.producer, "payment", true],
    [SEED_WALLETS.producer, "participant_activity", false],
    [SEED_WALLETS.vocalist, "project_activity", true],
  ];
  return rows.map(([wallet, category, enabled]) => ({
    id: seedUuid(`preference:${wallet}:${category}`),
    wallet,
    category,
    enabled,
    updatedAt: at(48),
  }));
}

function buildNotifications(
  transactions: SeedTransaction[],
  cancellations: SeedSplitCancellation[]
): SeedNotification[] {
  const rows: SeedNotification[] = [];

  const push = (
    recipient: string,
    category: NotificationCategory,
    eventKey: string,
    title: string,
    body: string,
    resourceType: string | null,
    resourceId: string | null,
    createdAt: Date,
    read: boolean
  ): void => {
    rows.push({
      id: seedUuid(`notification:${recipient}:${eventKey}`),
      recipient,
      category,
      title,
      body,
      eventKey,
      source: "dev-seed",
      resourceType,
      resourceId,
      metadata: { seed: true },
      readAt: read ? new Date(createdAt.getTime() + HOUR * 1000) : null,
      createdAt,
    });
  };

  push(
    SEED_WALLETS.owner,
    "security",
    "security:seed-new-session",
    "New sign-in to your account",
    "A new session was started for your wallet. This is sample data.",
    null,
    null,
    at(2),
    true
  );

  for (const project of PROJECTS) {
    push(
      project.owner,
      "project",
      `project-created:${project.projectId}`,
      `Project created: ${project.title}`,
      "Your split project was created. This is sample data.",
      "project",
      project.projectId,
      at(12),
      true
    );
  }

  transactions.forEach((tx, index) => {
    if (tx.status === "pending") return;
    const completed = tx.status === "completed";
    push(
      tx.recipient,
      "payment",
      `payment-${tx.status}:${tx.txHash}`,
      completed ? "Payout received" : "Payout failed",
      completed
        ? "A royalty payout was settled to your wallet. This is sample data."
        : "A royalty payout could not be settled. This is sample data.",
      "transaction",
      tx.txHash,
      new Date(tx.timestamp * 1000),
      // Leave every third one unread so the unread-count UI has data.
      index % 3 !== 0
    );
  });

  for (const cancellation of cancellations) {
    const project = PROJECTS.find((p) => p.projectId === cancellation.projectId);
    for (const participant of project?.participants ?? []) {
      push(
        participant.wallet,
        "participant",
        `project-cancelled:${cancellation.projectId}:${participant.wallet}`,
        "A project you are part of was cancelled",
        "The project owner cancelled this split. This is sample data.",
        "project",
        cancellation.projectId,
        cancellation.cancelledAt,
        false
      );
    }
  }

  push(
    SEED_WALLETS.dormant,
    "system",
    "system:seed-welcome",
    "Welcome to SplitNaira",
    "This account is inactive sample data.",
    null,
    null,
    at(4),
    false
  );

  return rows;
}

function buildSplitCancellations(): SeedSplitCancellation[] {
  return PROJECTS.filter((p) => p.cancelled).map((project) => ({
    id: seedUuid(`cancellation:${project.projectId}`),
    projectId: project.projectId,
    cancelledBy: project.owner,
    reason: "Sample data: the collaborators could not agree on the split.",
    cancelledAt: at(100),
  }));
}

function buildProjectEdits(): SeedProjectEdit[] {
  const rows: SeedProjectEdit[] = PROJECTS.map((project) => ({
    id: seedUuid(`edit:${project.projectId}:created`),
    projectId: project.projectId,
    actor: project.owner,
    action: "project.created",
    changes: { title: project.title, participantCount: project.participants.length },
    createdAt: at(12),
  }));

  rows.push({
    id: seedUuid(`edit:${SEED_PROJECT_IDS.film}:collaborators`),
    projectId: SEED_PROJECT_IDS.film,
    actor: SEED_WALLETS.owner,
    action: "collaborators.updated",
    changes: { participantCount: 3, note: "Added the outsider collaborator." },
    createdAt: at(16),
  });

  return rows;
}

/** Builds the full seed. Pure and deterministic. */
export function buildDevelopmentSeed(): DevelopmentSeed {
  const transactions = buildTransactions();
  const splitCancellations = buildSplitCancellations();
  return {
    users: buildUsers(),
    projects: PROJECTS.map((project) => ({
      ...project,
      participants: project.participants.map((p) => ({ ...p })),
    })),
    transactions,
    ledgerBlocks: buildLedgerBlocks(transactions),
    notificationPreferences: buildNotificationPreferences(),
    notifications: buildNotifications(transactions, splitCancellations),
    splitCancellations,
    projectEdits: buildProjectEdits(),
  };
}

export interface SeedSummary {
  users: number;
  projects: number;
  transactions: number;
  transactionsByStatus: Record<TransactionStatus, number>;
  ledgerBlocks: number;
  notificationPreferences: number;
  notifications: number;
  splitCancellations: number;
  projectEdits: number;
}

export function summarizeSeed(seed: DevelopmentSeed): SeedSummary {
  const transactionsByStatus: Record<TransactionStatus, number> = {
    pending: 0,
    completed: 0,
    failed: 0,
  };
  for (const tx of seed.transactions) transactionsByStatus[tx.status] += 1;

  return {
    users: seed.users.length,
    projects: seed.projects.length,
    transactions: seed.transactions.length,
    transactionsByStatus,
    ledgerBlocks: seed.ledgerBlocks.length,
    notificationPreferences: seed.notificationPreferences.length,
    notifications: seed.notifications.length,
    splitCancellations: seed.splitCancellations.length,
    projectEdits: seed.projectEdits.length,
  };
}
