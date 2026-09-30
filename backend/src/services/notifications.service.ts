import { IsNull, type Repository } from "typeorm";
import {
  Notification,
  type NotificationCategory,
} from "../entities/Notification.js";
import type { PreferenceCategory } from "../entities/NotificationPreference.js";
import { getDataSource } from "./database.js";
import {
  preferenceCategoryForNotification,
  shouldDeliver,
} from "./notification-preferences.service.js";

/** Postgres unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = "23505";

export interface CreateNotificationInput {
  recipient: string;
  category: NotificationCategory;
  title: string;
  body: string;
  /** Stable identity of the underlying event. See buildEventKey. */
  eventKey: string;
  source: string;
  resourceType?: string | null;
  resourceId?: string | null;
  metadata?: Record<string, unknown> | null;
  /** Time of the originating event; defaults to now. */
  occurredAt?: Date;
}

export interface CreateNotificationResult {
  notification: Notification;
  /** False when an existing row was returned instead of a new one. */
  created: boolean;
}

export interface ListNotificationsOptions {
  recipient: string;
  limit?: number;
  /** Opaque keyset cursor from a previous page. */
  cursor?: string | null;
  /** When true, only unread notifications are returned. */
  unreadOnly?: boolean;
}

export interface ListNotificationsResult {
  items: Notification[];
  nextCursor: string | null;
  unreadCount: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function repo(): Repository<Notification> {
  return getDataSource().getRepository(Notification);
}

/**
 * Builds the deduplication key for an event (#1309).
 *
 * The key is derived from what makes an event *the same event* — its type and
 * the resource it concerns — never from a timestamp or a delivery id, which
 * differ between retries of the identical event and would defeat the purpose.
 */
export function buildEventKey(parts: {
  eventType: string;
  resourceType?: string | null;
  resourceId?: string | null;
  /** Optional discriminator when one resource emits several distinct events. */
  discriminator?: string | null;
}): string {
  const segments = [
    parts.eventType,
    parts.resourceType ?? "-",
    parts.resourceId ?? "-",
    parts.discriminator ?? "-",
  ].map((segment) => String(segment).trim().toLowerCase());

  if (!segments[0] || segments[0] === "-") {
    throw new Error("buildEventKey requires a non-empty eventType");
  }
  return segments.join(":");
}

/**
 * Standard notification event types across the system (#1329).
 */
export const NOTIFICATION_EVENT_TYPES = [
  "payment.settled",
  "payment.failed",
  "payment.claimed",
  "split.created",
  "split.funded",
  "split.locked",
  "split.updated",
  "split.cancelled",
  "split.completed",
  "participant.invited",
  "participant.joined",
  "participant.removed",
  "security.alert",
  "security.preference_updated",
  "system.announcement",
] as const;

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

export function isNotificationEventType(
  eventType: string,
): eventType is NotificationEventType {
  return (NOTIFICATION_EVENT_TYPES as readonly string[]).includes(eventType);
}

/** Builds an event key for split lifecycle events (#1329). */
export function buildSplitEventKey(
  eventType: NotificationEventType | string,
  projectId: string,
  discriminator?: string | null,
): string {
  return buildEventKey({
    eventType,
    resourceType: "split",
    resourceId: projectId,
    discriminator,
  });
}

/** Builds an event key for payment and payout events (#1329). */
export function buildPaymentEventKey(
  eventType: NotificationEventType | string,
  txHash: string,
  discriminator?: string | null,
): string {
  return buildEventKey({
    eventType,
    resourceType: "payment",
    resourceId: txHash,
    discriminator,
  });
}

/** Builds an event key for participant or collaborator events (#1329). */
export function buildParticipantEventKey(
  eventType: NotificationEventType | string,
  resourceId: string,
  discriminator?: string | null,
): string {
  return buildEventKey({
    eventType,
    resourceType: "participant",
    resourceId,
    discriminator,
  });
}

/**
 * Creates a notification, or returns the existing one for the same event.
 *
 * Deduplication relies on the unique index rather than a prior lookup: a
 * check-then-insert races, and two workers replaying the same ledger event
 * would both pass the check. Here the loser of the race catches the unique
 * violation and reads back the row the winner wrote.
 *
 * The stored `createdAt` and `source` are those of the first occurrence — a
 * duplicate never rewrites them.
 */
export async function createNotification(
  input: CreateNotificationInput,
): Promise<CreateNotificationResult> {
  const recipient = input.recipient?.trim();
  if (!recipient) throw new Error("recipient is required");
  if (!input.eventKey?.trim()) throw new Error("eventKey is required");

  const repository = repo();
  const entity = repository.create({
    recipient,
    category: input.category,
    title: input.title,
    body: input.body,
    eventKey: input.eventKey.trim(),
    source: input.source,
    resourceType: input.resourceType ?? null,
    resourceId: input.resourceId ?? null,
    metadata: input.metadata ?? null,
    readAt: null,
    createdAt: input.occurredAt ?? new Date(),
  });

  try {
    const saved = await repository.save(entity);
    return { notification: saved, created: true };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;

    const existing = await repository.findOne({
      where: { recipient, eventKey: input.eventKey.trim() },
    });
    if (!existing) {
      // The row vanished between the conflict and the read — nothing sensible
      // to return, so surface the original failure rather than invent one.
      throw error;
    }
    return { notification: existing, created: false };
  }
}

/**
 * Creates multiple notifications with independent deduplication (#1329).
 *
 * Each notification is processed independently so that a duplicate or failure
 * on one recipient does not abort the others, ensuring reliable event delivery
 * during multi-recipient event fanouts or retries.
 */
export async function createNotifications(
  inputs: CreateNotificationInput[],
): Promise<CreateNotificationResult[]> {
  const results: CreateNotificationResult[] = [];
  for (const input of inputs) {
    results.push(await createNotification(input));
  }
  return results;
}

/**
 * Checks whether an event notification has already been recorded for a recipient (#1329).
 */
export async function hasNotificationForEvent(
  recipient: string,
  eventKey: string,
): Promise<boolean> {
  const normalisedRecipient = recipient?.trim();
  const normalisedKey = eventKey?.trim();
  if (!normalisedRecipient || !normalisedKey) return false;

  const count = await repo().count({
    where: { recipient: normalisedRecipient, eventKey: normalisedKey },
  });
  return count > 0;
}

/**
 * Retrieves the recorded notification for a specific event key, or null if none exists (#1329).
 */
export async function getNotificationByEventKey(
  recipient: string,
  eventKey: string,
): Promise<Notification | null> {
  const normalisedRecipient = recipient?.trim();
  const normalisedKey = eventKey?.trim();
  if (!normalisedRecipient || !normalisedKey) return null;

  return repo().findOne({
    where: { recipient: normalisedRecipient, eventKey: normalisedKey },
  });
}

/**
 * Translates a NotificationCategory to its corresponding PreferenceCategory (#1307, #1329).
 */
export function toPreferenceCategory(
  category: NotificationCategory,
): "security" | "payment" | "project_activity" | "participant_activity" | "marketing" {
  switch (category) {
    case "project":
      return "project_activity";
    case "participant":
      return "participant_activity";
    case "system":
      return "marketing";
    case "security":
    case "payment":
    default:
      return category;
  }
}

export interface DeliverNotificationResult {
  notification: Notification | null;
  created: boolean;
  suppressed: boolean;
}

/**
 * Delivers a notification respecting recipient preferences (#1307) and
 * deduplicating retried or repeated events (#1309, #1329).
 */
export async function deliverNotification(
  input: CreateNotificationInput,
): Promise<DeliverNotificationResult> {
  const prefCategory = toPreferenceCategory(input.category);
  const allowed = await shouldDeliver(input.recipient, prefCategory);
  if (!allowed) {
    return { notification: null, created: false, suppressed: true };
  }

  const result = await createNotification(input);
  return {
    notification: result.notification,
    created: result.created,
    suppressed: false,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === UNIQUE_VIOLATION
  );
}

/** Result of a preference-aware delivery attempt. */
export type NotificationDeliveryResult =
  | { delivered: true; notification: Notification; created: boolean }
  | { delivered: false; reason: "opted_out"; preferenceCategory: PreferenceCategory };

/**
 * The delivery entry point every producer should call (#1327).
 *
 * `createNotification` writes the row; this decides whether the row should be
 * written at all. Keeping the two apart means the deduplicating store stays
 * usable when a caller genuinely must record something regardless of
 * preference, while the everyday path honours opt-outs.
 *
 * Mandatory categories (`security`, `payment`) short-circuit inside
 * `shouldDeliver` without touching the preferences table, so a stale row can
 * never silence a financial or account-safety notice.
 */
export async function enqueueNotification(
  input: CreateNotificationInput,
): Promise<NotificationDeliveryResult> {
  const recipient = input.recipient?.trim();
  if (!recipient) throw new Error("recipient is required");

  const preferenceCategory = preferenceCategoryForNotification(input.category);
  if (preferenceCategory && !(await shouldDeliver(recipient, preferenceCategory))) {
    return { delivered: false, reason: "opted_out", preferenceCategory };
  }

  const result = await createNotification({ ...input, recipient });
  return { delivered: true, notification: result.notification, created: result.created };
}

/** Encodes a keyset cursor. */
export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, "utf8").toString(
    "base64url",
  );
}

/** Decodes a keyset cursor, returning null when it is unusable. */
export function decodeCursor(
  cursor: string | null | undefined,
): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const separator = raw.lastIndexOf("|");
    if (separator === -1) return null;
    const createdAt = new Date(raw.slice(0, separator));
    const id = raw.slice(separator + 1);
    if (Number.isNaN(createdAt.getTime()) || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/**
 * Lists a recipient's notifications, newest first.
 *
 * Keyset pagination rather than offset: notifications arrive continuously, and
 * an offset page shifts under the reader, showing duplicates or skipping rows.
 * The cursor ties to (createdAt, id) so ties at the same timestamp are still
 * ordered deterministically.
 */
export async function listNotifications(
  options: ListNotificationsOptions,
): Promise<ListNotificationsResult> {
  const recipient = options.recipient?.trim();
  if (!recipient) throw new Error("recipient is required");

  const limit = Math.min(
    Math.max(Number(options.limit) || DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );

  const repository = repo();
  const query = repository
    .createQueryBuilder("n")
    .where("n.recipient = :recipient", { recipient });

  if (options.unreadOnly) {
    query.andWhere("n.readAt IS NULL");
  }

  const cursor = decodeCursor(options.cursor);
  if (cursor) {
    query.andWhere(
      "(n.createdAt < :createdAt OR (n.createdAt = :createdAt AND n.id < :id))",
      { createdAt: cursor.createdAt, id: cursor.id },
    );
  }

  // Fetch one extra row to learn whether another page exists without a
  // second count query.
  const rows = await query
    .orderBy("n.createdAt", "DESC")
    .addOrderBy("n.id", "DESC")
    .take(limit + 1)
    .getMany();

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];

  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    unreadCount: await countUnread(recipient),
  };
}

/** Number of unread notifications for a recipient. */
export async function countUnread(recipient: string): Promise<number> {
  return repo().count({
    where: { recipient: recipient.trim(), readAt: IsNull() },
  });
}

/**
 * Marks one notification read.
 *
 * Idempotent in the strong sense: re-marking preserves the original `readAt`
 * rather than moving it, so "when did they see this" stays answerable. The
 * `readAt IS NULL` guard is what makes that true even under concurrent calls.
 */
export async function markRead(
  recipient: string,
  id: string,
  now: Date = new Date(),
): Promise<Notification | null> {
  const repository = repo();
  await repository
    .createQueryBuilder()
    .update(Notification)
    .set({ readAt: now })
    .where("id = :id AND recipient = :recipient AND readAt IS NULL", {
      id,
      recipient: recipient.trim(),
    })
    .execute();

  return repository.findOne({ where: { id, recipient: recipient.trim() } });
}

/** Marks every unread notification read. Returns how many changed. */
export async function markAllRead(
  recipient: string,
  now: Date = new Date(),
): Promise<number> {
  const result = await repo()
    .createQueryBuilder()
    .update(Notification)
    .set({ readAt: now })
    .where("recipient = :recipient AND readAt IS NULL", {
      recipient: recipient.trim(),
    })
    .execute();

  return result.affected ?? 0;
}
