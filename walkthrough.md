# Walkthrough — Add Notification Deduplication (#1329)

## PR Title
`feat(notifications): add notification event keys and retry deduplication (#1329)`

## PR Description

### What
Define canonical notification event keys, typed builders, batch event deduplication, and preference-aware notification delivery to prevent duplicate notifications during retries or repeated events.

### Why
Closes #1329.
When external webhooks, ledger transaction listeners, or distribution jobs retry or replay events, notifications can be repeatedly dispatched to participants. Robust deduplication requires canonical event keys across all domain operations and database-enforced deduplication so that concurrent workers or repeated deliveries safely converge.

### How
- **Canonical Event Types & Key Builders** (`backend/src/services/notifications.service.ts`):
  - Defined `NOTIFICATION_EVENT_TYPES` covering split lifecycle (`split.created`, `split.funded`, `split.locked`, `split.updated`, `split.cancelled`, `split.completed`), payment settlement (`payment.settled`, `payment.failed`, `payment.claimed`), participant collaboration (`participant.invited`, `participant.joined`, `participant.removed`), security alerts (`security.alert`, `security.preference_updated`), and system announcements (`system.announcement`).
  - Added typed builders: `buildSplitEventKey`, `buildPaymentEventKey`, and `buildParticipantEventKey`.
- **Batch Deduplication** (`backend/src/services/notifications.service.ts`):
  - Implemented `createNotifications(inputs)` ensuring that multi-recipient event fanouts independently deduplicate without aborting entire batches when retried.
- **Deduplication Query Helpers** (`backend/src/services/notifications.service.ts`):
  - Added `hasNotificationForEvent(recipient, eventKey)` and `getNotificationByEventKey(recipient, eventKey)` to allow callers to verify if an event notification has already been recorded before initiating redundant work.
- **Preference-Aware Delivery** (`backend/src/services/notifications.service.ts`):
  - Added `toPreferenceCategory` and `deliverNotification(input)` to respect participant notification preferences while maintaining idempotency and retry deduplication.
- **Unit Test Coverage** (`backend/src/__tests__/notifications.service.test.ts`):
  - Added comprehensive test suites verifying standard event types, typed key builders, batch deduplication, query helpers, and preference-aware delivery during retries.

## Files Changed

| File | Changes |
|---|---|
| `backend/src/services/notifications.service.ts` | Added `NOTIFICATION_EVENT_TYPES`, `buildSplitEventKey`, `buildPaymentEventKey`, `buildParticipantEventKey`, `createNotifications`, `hasNotificationForEvent`, `getNotificationByEventKey`, `toPreferenceCategory`, and `deliverNotification`. |
| `backend/src/__tests__/notifications.service.test.ts` | Added test suites for event key builders, batch deduplication, event queries, and delivery with preferences. |

## CI Results
- Typecheck: Pending installation completion
- Lint: Pending installation completion
- Tests: Pending installation completion
