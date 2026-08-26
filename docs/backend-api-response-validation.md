# Backend API Response Validation Architecture

This document describes response schema validation in SplitNaira, specifically covering privileged admin routes, ops diagnostics, audit context metadata, and intentionally unvalidated streaming endpoints.

---

## 1. Overview and Problem Statement

Privileged admin routes power critical operator dashboards, emergency circuit-breakers, incident response tooling, and automated health checks. If an unexpected code change or refactor causes response schema drift on these routes, admin tooling can silently fail during active operational incidents.

To prevent drift and guarantee API correctness:
1. **Schema Contracts:** Every admin and operations endpoint is typed and validated using Zod schemas (`backend/src/schemas/admin.schemas.ts`).
2. **Response Interceptor:** Route handlers are wrapped with `withResponseValidation(schema, handler)` (`backend/src/middleware/validateResponse.ts`).
3. **Strict Validation in Production:** In production (or when `STRICT_RESPONSE_VALIDATION=true`), schema mismatches immediately return HTTP `500` and increment the in-process metric counter `splitnaira_validation_failures_total`.
4. **OpenAPI Alignment:** Admin and operations routes are fully registered in `backend/src/openapi.ts` and verified in CI via `npm run drift:openapi`.

---

## 2. Admin & Ops Route Validation Coverage

The following privileged routes are wrapped with strict response validation:

| Route | HTTP Method | Response Schema | Purpose |
|---|---|---|---|
| `/splits/admin/status` | `GET` | `AdminStatusResponseSchema` | Returns current contract admin address and global pause state. |
| `/splits/admin/is-token-allowed` | `GET` | `AdminIsTokenAllowedResponseSchema` | Verifies whether a token address is allowed. |
| `/splits/admin/token-count` | `GET` | `AdminTokenCountResponseSchema` | Returns total number of allowlisted tokens. |
| `/splits/admin/unallocated` | `GET` | `AdminUnallocatedResponseSchema` | Returns recoverable unallocated stroop balance for a token. |
| `/splits/admin/cache-stats` | `GET` | `AdminCacheStatsResponseSchema` | Returns in-memory read cache metrics and configured TTL. |
| `/splits/admin/allow-token` | `POST` | `AdminUnsignedXdrResponseSchema` | Builds unsigned XDR to allow a token contract. |
| `/splits/admin/disallow-token` | `POST` | `AdminUnsignedXdrResponseSchema` | Builds unsigned XDR to disallow a token contract. |
| `/splits/admin/pause-distributions` | `POST` | `AdminUnsignedXdrResponseSchema` | Builds unsigned XDR to pause contract distributions. |
| `/splits/admin/unpause-distributions` | `POST` | `AdminUnsignedXdrResponseSchema` | Builds unsigned XDR to unpause contract distributions. |
| `/splits/admin/withdraw-unallocated` | `POST` | `AdminUnsignedXdrResponseSchema` | Builds unsigned XDR with audit metadata to recover funds. |
| `/ops/status` | `GET` | `OpsStatusResponseSchema` | Returns EventListener health, lag, and DB status. |
| `/ops/mainnet-readiness` | `GET` | `MainnetReadinessResponseSchema` | Evaluates environment, DB, cache, and secrets readiness. |
| `/ops/backfill` | `POST` | `OpsBackfillResponseSchema` | Returns status of ledger event backfill operation. |

---

## 3. Audit Context Validation

Admin mutations (such as `POST /splits/admin/withdraw-unallocated`) generate an audit context attached to the response metadata:

```json
{
  "xdr": "AAAAAgAAA...",
  "metadata": {
    "contractId": "CAGR5U5IBEPFVJDZPZUXXNCPXAHNZ6TWVIUTI5RLRH3SZSU4O2VXDOPF",
    "networkPassphrase": "Test SDF Network ; September 2015",
    "sourceAccount": "GBJRKIYXAAFD3NZCWJXGUTNKYUQFZC2ANS6LRMBPJCE4IZSMJJMZPQBT",
    "operation": "withdraw_unallocated",
    "auditContext": {
      "token": "CDOVDY3MZDG7PHCGVP7EP2EKQ2ENV26DZW6FKLBRN42LOGIZGXZV3WX5",
      "destination": "GCZTK3PNYXCVF7Z3ELVELEJZ7BVGPGPVJ3NVZNI7O6DVCHPA4JU6LXRV",
      "amount": 500000,
      "initiatedAt": "2026-08-26T18:00:00.000Z"
    }
  }
}
```

The response validation schema `AdminUnsignedXdrResponseSchema` explicitly verifies:
- Base64 `xdr` string validity.
- Required `metadata` keys (`contractId`, `networkPassphrase`, `sourceAccount`, `operation`).
- Sanitized `auditContext` dictionary without leaking sensitive secrets or raw private keys.

---

## 4. Intentionally Unvalidated Streaming Routes

Certain backend endpoints do not return a single discrete JSON document. The following endpoints are **intentionally exempt** from `withResponseValidation`:

### 1. `GET /events` (SSE Transaction Stream)
- **Content-Type:** `text/event-stream`
- **Protocol:** Server-Sent Events (SSE)
- **Rationale:** Keeps an open HTTP connection to stream real-time transaction lifecycle events (`transaction_update`) and periodic `: keep-alive` comments. Each discrete payload chunk is individually formatted by `sendSseEvent()`. Wrapping the overall response with single-payload JSON validation would break the streaming protocol.

### 2. `GET /events/transactions/:txHash` (SSE Confirmation Stream)
- **Content-Type:** `text/event-stream`
- **Protocol:** Server-Sent Events (SSE)
- **Rationale:** Long-lived connection for transaction confirmation tracking with `: heartbeat` frames. Emits structured `transaction:confirmed` events as they are processed by the Soroban event ingestion service.

### 3. `GET /metrics` (Prometheus Metrics)
- **Content-Type:** `text/plain; version=0.0.4`
- **Protocol:** Prometheus Exposition Format
- **Rationale:** Exposes Prometheus metric lines with HELP and TYPE descriptors. Not a JSON endpoint.

---

## 5. Configuration & Environment Variables

| Variable | Default | Description |
|---|---|---|
| `STRICT_RESPONSE_VALIDATION` | `"true"` in prod, `"false"` in dev | If `"true"`, response validation errors return HTTP `500` and log the diff. If `"false"`, mismatches log an error and forward the payload for debugging. |
| `PAYMENTS_ADMIN_API_KEY` | `""` | Optional shared secret header required via `x-admin-api-key`. |
| `PAYMENTS_ADMIN_WRITE_ENABLED` | `"true"` | Global emergency toggle; when `"false"`, blocks write operations under `/splits/admin`. |

---

## 6. Verification and Testing

To verify response validation across admin routes:
```bash
# Run all backend tests including admin validation tests
cd backend && npm test

# Run specific admin response validation suite
cd backend && npx vitest run src/__tests__/admin-response-validation.test.ts

# Check for OpenAPI drift
npm run drift:openapi
```
