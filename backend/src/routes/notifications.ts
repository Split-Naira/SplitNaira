import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authJwtMiddleware } from "../middleware/auth-jwt.js";
import {
  MANDATORY_CATEGORIES,
  PREFERENCE_CATEGORIES,
  type PreferenceCategory,
} from "../entities/NotificationPreference.js";
import {
  getPreferences,
  MandatoryCategoryError,
  updatePreferences,
  type ResolvedPreference,
} from "../services/notification-preferences.service.js";
import {
  listNotifications,
  markAllRead,
  markRead,
} from "../services/notifications.service.js";

export const notificationsRouter = Router();

// Every route here is scoped to the authenticated wallet. The recipient is
// taken from the verified token, never from the request, so one user cannot
// read or acknowledge another's notifications by changing a parameter.
notificationsRouter.use(authJwtMiddleware);

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).max(512).optional(),
  unreadOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

const idParamSchema = z.object({ id: z.string().uuid() });

// `PREFERENCE_CATEGORIES` is a readonly tuple, which `z.enum` accepts at
// runtime but types loosely. Asserting the tuple keeps the route and the entity
// tied together: a category added to the entity is accepted here without a
// second list to forget.
const preferenceCategorySchema = z.enum(
  PREFERENCE_CATEGORIES as readonly [
    PreferenceCategory,
    ...PreferenceCategory[],
  ],
);

const updatePreferencesSchema = z.object({
  preferences: z
    .array(
      z.object({
        category: preferenceCategorySchema,
        enabled: z.boolean(),
      }),
    )
    .min(1)
    .max(PREFERENCE_CATEGORIES.length),
});

/**
 * Shapes the preference payload for the client. The full category catalogue is
 * always returned alongside the resolved rows so a UI can render every toggle
 * — including categories the user has never touched, which default to enabled
 * — without hardcoding the list.
 */
function serializePreferences(preferences: ResolvedPreference[]) {
  return {
    categories: [...PREFERENCE_CATEGORIES],
    mandatoryCategories: [...MANDATORY_CATEGORIES],
    optionalCategories: PREFERENCE_CATEGORIES.filter(
      (category) => !MANDATORY_CATEGORIES.includes(category),
    ),
    preferences,
  };
}

function recipientOf(req: Request): string {
  return req.user!.walletAddress;
}

/**
 * @openapi
 * GET /notifications
 * summary: List the authenticated user's notifications
 * description: Newest first, keyset-paginated. Returns the unread count alongside the page.
 * tags: [Notifications]
 */
notificationsRouter.get(
  "/",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { limit, cursor, unreadOnly } = listQuerySchema.parse(req.query);
      const result = await listNotifications({
        recipient: recipientOf(req),
        limit,
        cursor,
        unreadOnly,
      });

      return res.status(200).json({
        items: result.items.map(serialize),
        nextCursor: result.nextCursor,
        unreadCount: result.unreadCount,
      });
    } catch (error) {
      return next(error);
    }
  },
);

/**
 * @openapi
 * GET /notifications/preferences
 * summary: Read the authenticated user's notification preferences
 * description: >
 *   Returns every category, the mandatory/optional split, and the resolved
 *   preference for each. Categories with no stored row default to enabled, so
 *   adding a category later never silently mutes it for existing users.
 * tags: [Notifications]
 */
notificationsRouter.get(
  "/preferences",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const preferences = await getPreferences(recipientOf(req));
      return res.status(200).json(serializePreferences(preferences));
    } catch (error) {
      return next(error);
    }
  },
);

/**
 * @openapi
 * PUT /notifications/preferences
 * summary: Update the authenticated user's notification preferences
 * description: >
 *   Upserts on (wallet, category), so repeated saves converge. Attempting to
 *   disable a mandatory category is refused with 400 rather than ignored — a UI
 *   that believes it switched a notice off while the backend keeps sending is
 *   worse than an explicit error.
 * tags: [Notifications]
 */
notificationsRouter.put(
  "/preferences",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { preferences } = updatePreferencesSchema.parse(req.body);
      const updated = await updatePreferences(recipientOf(req), preferences);
      return res.status(200).json(serializePreferences(updated));
    } catch (error) {
      if (error instanceof MandatoryCategoryError) {
        return res.status(400).json({
          error: "mandatory_category",
          code: "MANDATORY_CATEGORY",
          message: error.message,
          requestId: res.locals.requestId,
          details: { category: error.category },
        });
      }
      return next(error);
    }
  },
);

/**
 * @openapi
 * POST /notifications/{id}/read
 * summary: Mark one notification read
 * description: Idempotent — re-marking preserves the original read timestamp.
 * tags: [Notifications]
 */
notificationsRouter.post(
  "/:id/read",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = idParamSchema.parse(req.params);
      const updated = await markRead(recipientOf(req), id);

      if (!updated) {
        // Also the answer when the notification belongs to someone else:
        // distinguishing "not yours" from "not found" would leak existence.
        return res.status(404).json({
          error: "not_found",
          message: "Notification not found.",
        });
      }

      return res.status(200).json(serialize(updated));
    } catch (error) {
      return next(error);
    }
  },
);

/**
 * @openapi
 * POST /notifications/read-all
 * summary: Mark every unread notification read
 * tags: [Notifications]
 */
notificationsRouter.post(
  "/read-all",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await markAllRead(recipientOf(req));
      return res.status(200).json({ updated });
    } catch (error) {
      return next(error);
    }
  },
);

/** Shapes a notification for the API, linking it to its resource. */
function serialize(notification: {
  id: string;
  category: string;
  title: string;
  body: string;
  resourceType: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  readAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: notification.id,
    category: notification.category,
    title: notification.title,
    body: notification.body,
    resource:
      notification.resourceType && notification.resourceId
        ? { type: notification.resourceType, id: notification.resourceId }
        : null,
    metadata: notification.metadata,
    read: notification.readAt !== null,
    readAt: notification.readAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString(),
  };
}
