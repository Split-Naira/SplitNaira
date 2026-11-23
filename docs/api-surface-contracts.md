# API Surface Contracts

This document describes the cross-cutting contracts the backend API guarantees
to clients, and how they are enforced in tests. It complements the generated
OpenAPI document served at `/api/openapi.json`.

## Unknown-route (404) contract

Any request that does not match a mounted route — wrong path, wrong method, or
a deleted endpoint — returns the same stable, machine-readable 404 body. The
response never echoes the request line, query string, request body, stack
traces, or internal routing details.

```json
{
  "error": "not_found",
  "code": "NOT_FOUND",
  "message": "The requested resource does not exist.",
  "requestId": "b6f1a2d4-8c3e-4a1b-9f2e-6d5c7a8b9c0d",
  "details": {}
}
```

Clients must branch on `code` (`NOT_FOUND`), never on `message`. The
implementation lives in `backend/src/middleware/error.ts` (`notFoundHandler`)
and is pinned by `backend/src/middleware/__tests__/unknown-route-contract.test.ts`.

## Stable error envelope across route families (#1640)

Every failure response from a public route family (`/splits`, `/splits/admin`,
`/users`, `/auth`, `/collaboration`, `/transactions`, `/notifications`,
`/api/ledger`, `/events`) uses the same envelope as the unknown-route contract:

```json
{
  "error": "invalid_or_expired_token",
  "code": "INVALID_OR_EXPIRED_TOKEN",
  "message": "The link is invalid or has expired.",
  "requestId": "client-or-generated-id",
  "details": {}
}
```

- `code` is the stable UPPER*SNAKE identifier that clients branch on, and
  `error` is usually its snake_case form. A few older responses pair a more
  specific `code` with a broader `error`, and they keep both for
  compatibility: `SESSION_REVOKED` with `unauthorized`, and
  `RESOURCE_LIMIT_EXCEEDED` with the SSE `too_many*\*` errors.
- `requestId` always matches the `x-request-id` response header. A safe
  client-supplied `x-request-id` (or `x-correlation-id`) is echoed back, even
  when the request fails while its body is being parsed. A JWT-shaped or
  otherwise unsafe value is replaced with a generated UUID.
- `details` is always an object. Fields that a route returned at the top level
  before this contract (for example `decision` on a blocked project deletion,
  or `permission`/`role`/`reason` on `PERMISSION_DENIED`) are still returned
  there.

Routes that answer a failure themselves use `sendErrorResponse()` from
`backend/src/middleware/error.ts`. Everything else is thrown to
`errorHandler`, which produces the same shape. The contract is pinned per
family by `backend/src/__tests__/route-family-error-codes.test.ts`.

## Deprecation and Sunset headers

Endpoints scheduled for removal advertise it on every response so clients can
migrate before the sunset date:

| Header        | Standard | Meaning                                                   |
| :------------ | :------- | :-------------------------------------------------------- |
| `Deprecation` | RFC 9745 | IMF-fixdate the endpoint became deprecated.               |
| `Sunset`      | RFC 8594 | IMF-fixdate after which the endpoint may stop responding. |
| `Link`        | RFC 8288 | `<replacement>; rel="deprecation"` — where to migrate.    |

Example response headers:

```
Deprecation: Thu, 01 Jan 2026 00:00:00 GMT
Sunset: Fri, 01 Jan 2027 00:00:00 GMT
Link: </health/ready>; rel="deprecation"
```

Deprecations are declared in `API_DEPRECATIONS` in
`backend/src/middleware/deprecation.ts`. The registry is validated at boot: an
invalid date, or a `sunset` that is not after `deprecatedAt`, fails startup
rather than emitting a misleading header.

### Registering a new deprecation

1. Add an entry to `API_DEPRECATIONS` with `key`, `deprecatedAt`, `sunset`,
   `replacement` and a short `documentation` note.
2. Apply `deprecationHeaders("<key>")` to the route, e.g.

   ```ts
   router.get("/legacy-thing", deprecationHeaders("legacy-thing"), handler);
   ```

3. Add a case to `backend/src/middleware/__tests__/deprecation.test.ts`.
4. Note the removal window in the changelog/release notes.

`GET /health` (the backwards-compatibility alias for `GET /health/ready`) is
the first registered deprecation.

## Transaction pagination contract

`GET /transactions/history` and `GET /transactions/recipient/:walletAddress`
share one pagination contract (#1259):

- **Stable order.** Rows are ordered by `(timestamp DESC, id DESC)`. `timestamp`
  alone is not a total order, so `id` is the tie-breaker.
- **Cursor.** A response with more rows carries `nextCursor`. Send it back as
  `?cursor=<value>` to fetch the next page. The cursor is opaque (base64url of
  `{ t, i }`) and is validated before it reaches SQL; a malformed value is
  `400 VALIDATION_ERROR` with `details: { cursor: "invalid" }` and no query is
  run.
- **Page size.** `limit` is capped at 100; `101` is a `400`.
- **Offset fallback.** `offset` remains supported for existing clients. When
  both `cursor` and `offset` are sent, `cursor` wins — mixing them would make
  the page depend on inserts that happened since the cursor was issued.
- **`total`** always counts every row matching the filters, not just the rows
  after the cursor.
- **`hasMore`** is derived from a `limit + 1` probe, so a full last page is not
  reported as having a next page.

The response shape is documented in `docs/openapi.yaml`; the codec lives in
`backend/src/lib/keyset-cursor.ts` and is pinned by
`backend/src/__tests__/keyset-cursor.test.ts` and
`backend/src/__tests__/transactions-pagination.test.ts`.

## Unknown payout outcomes

`POST /transactions/recovery/attempts` only records that a hash was submitted,
so its response is `status: "pending"` — not proof the payout landed. Clients
must poll `GET /transactions/recovery/attempts/{txHash}`:

| Observation from Soroban RPC | Persisted status                             | Client action               |
| :--------------------------- | :------------------------------------------- | :-------------------------- |
| `NOT_FOUND`                  | `pending` (unknown, may still be in flight)  | Keep polling; do not retry. |
| `NOT_FOUND` past 6 minutes   | `failed`, `failureCode: transaction_expired` | Retry under a new hash.     |
| `SUCCESS`                    | `completed` (final)                          | Stop polling.               |
| `FAILED`                     | `failed`, `failureCode: transaction_failed`  | Retry under a new hash.     |

Never resubmit while `pending`: the original transaction can still land and a
second submission can pay collaborators twice. Only `failed` is final and
retryable, and a retry must be a newly built, signed transaction with its own
hash. The descriptions and field guidance are generated into
`docs/openapi.yaml` and pinned by
`backend/src/__tests__/openapi-transaction-outcomes.test.ts`.

## Split response casing and compatibility window

Split/project responses are accepted and emitted in two casings during the
compatibility window that ends **2027-01-01**:

| Current (preferred) | Legacy alias         | Notes                          |
| :------------------ | :------------------- | :----------------------------- |
| `projectId`         | `project_id`         |                                |
| `projectType`       | `project_type`       |                                |
| `totalDistributed`  | `total_distributed`  | Stays a string (stroops).      |
| `distributionRound` | `distribution_round` |                                |
| `basisPoints`       | `basis_points`       | Inside each `collaborators[]`. |

`camelCase` wins when a payload contains both forms. `balance` and
`totalDistributed` remain decimal strings end-to-end so 64-bit stroop amounts are
never rounded through a JavaScript number. The legacy aliases were frozen on
2026-01-01 and may only be removed after the sunset date with a major version
bump and a frontend release that no longer reads them.

The fixtures and field list live in
`backend/src/fixtures/split-response.compatibility.ts`; the window, alias list,
casing precedence, and boundary defaults are pinned by
`backend/src/fixtures/split-response.compatibility.test.ts`.

## Per-route rate limits

Route groups have deliberately distinct budgets (auth, admin, read, write,
SSE). The policies, env overrides, response headers and `429` payload are
documented in [rate-limiting-guidance.md](./rate-limiting-guidance.md).

## Contract tests

`backend/src/__tests__/api-contract.test.ts` runs the real Express app and
checks the responses against the generated OpenAPI document:

- the generated document is a valid OpenAPI 3.0 document,
- the operations the clients depend on are documented,
- `GET /api/openapi.json` serves exactly the generated spec,
- every documented operation declares at least one `2xx` response,
- representative responses only contain documented fields (a new, accidental
  field fails the test; the few known additive fields are listed explicitly in
  the test), and
- the unknown-route and validation-error envelopes match the documented shape
  and never leak stack traces.

The representative public JSON success responses are checked against the
top-level fields declared in OpenAPI. Admin and ops responses additionally use
`withResponseValidation` at runtime. Public routes are currently contract
tested rather than wrapped with that runtime middleware; this avoids adding a
second response check where a route already owns a typed contract and makes
the documented contract the shared source of truth. When adding a public JSON
route, add a representative success response check and cover its error or
boundary behavior in the route tests. Keep the schema test strict about
unexpected top-level fields; any intentional additive fields must be explained
and listed in `KNOWN_ADDITIVE_FIELDS` in `api-contract.test.ts`.

Single-payload JSON validation intentionally does not apply to `GET /events`,
`GET /events/transactions/:txHash`, or `GET /metrics`: these stream SSE or
Prometheus text over an open connection. Validate event payloads where they
are produced and preserve the documented stream content type and framing.

## HTTP method allowlist

Express dispatches only the verbs registered for a route. An unsupported verb
at an otherwise known resource falls through to the same static 404 contract
as an unknown path. Tests exercise unsupported verbs on write resources and
assert the handler does not run or reflect request data. `HEAD` is supported
as Express's bodyless equivalent of `GET`; `OPTIONS` is handled by the global
CORS middleware as a preflight response and is not a 404. Keep these framework
exceptions explicit when adding or changing method tests.

Run it with:

```bash
npm test -w backend -- api-contract.test.ts
```

## Related

- [Rate-limiting guidance](./rate-limiting-guidance.md)
- [API Evolution Runbook](./runbooks/api-evolution-runbook.md)
- [Generated OpenAPI document](./openapi.yaml)
