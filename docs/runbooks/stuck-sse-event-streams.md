# Runbook: Stuck SSE Event Streams

For when transaction/event SSE streams stop updating for clients.

## Detection

- Client-side: `useTransactionStream` last-event timestamp exceeds the expected heartbeat interval.
- Server-side: no events emitted on a connection for longer than the configured heartbeat.

## Logs & metrics to check

- Backend SSE controller logs for the affected connection/user ID.
- Active connection count metric (a stall often correlates with a spike or drop here).
- Underlying event source (queue/DB listener) lag or error logs.

## Restart steps

1. Confirm the issue is server-side, not a client network drop (check another client/session).
2. Restart the SSE-publishing process/worker if it has stopped consuming from the event source.
3. Ask affected clients to reconnect (reload or resubscribe) once the server side is healthy.
4. Verify new events are flowing before closing the incident.

## Customer-facing guidance

Tell affected users their data is not lost — refreshing the page will resync current state, since SSE only carries live updates on top of an initial fetch.
