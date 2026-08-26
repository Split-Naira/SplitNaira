# Frontend State Management Architecture

Quick map of where key application state lives, for contributors adding new UI features.

## State owners

| Domain | Owner | Notes |
| :--- | :--- | :--- |
| Wallet connection | `useWallet` hook | Holds public key, network, signing status |
| Active project | `useProject` hook | Current split project + collaborators |
| Transaction status | `useTransactionStream` hook | Backed by the SSE event stream |
| Cached reads (balances, splits) | React Query cache | TTL-based, invalidated on write success |

## Data flow

1. User action triggers a component handler.
2. Handler calls a service function (`services/*`), which hits the backend/contract.
3. On success, the relevant React Query cache key is invalidated so dependent components refetch.
4. Long-running effects (SSE subscriptions, polling) live in dedicated hooks, not in page components.

## Guidance for new features

- Side effects (network calls, subscriptions) belong in a hook, not inline in JSX.
- Prefer invalidating a query key over manually patching cached data.
- If new state is shared across more than one route, lift it into a hook under `hooks/`, not component state.
