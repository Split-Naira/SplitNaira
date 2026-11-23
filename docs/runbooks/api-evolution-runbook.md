### 🔄 API Casing & Field Deprecation Guidelines

To prevent breaking mobile or legacy web clients during backend refactoring, follow these contract guarantees regarding payload casing:

1. **Dual-Casing Backward Compatibility**:
   - All API response payloads for `splits`/`projects` must support dual casing mapping (`camelCase` preferred, `snake_case` fallback).
   - Key field aliases (e.g., `target_amount` and `targetAmount`) must remain supported in shared contract mappers until a major version deprecation cycle.
2. **Contract Testing Requirement**:
   - Any change to split response serialisation must pass `backend/src/fixtures/split-response.compatibility.test.ts`.
   - The supported legacy aliases and compatibility window are pinned in `backend/src/fixtures/split-response.compatibility.ts` and documented in [API Surface Contracts](../api-surface-contracts.md#split-response-casing-and-compatibility-window).
   - Tests must validate both casing fixtures, mixed-casing precedence, and the absent-field defaults.

---

### 🛡️ API Surface Contracts (backend)

Cross-cutting guarantees enforced by tests. Full detail in
[API Surface Contracts](../api-surface-contracts.md).

1. **Unknown-route (404) contract** — the catch-all returns a static,
   machine-readable body (`error: "not_found"`, `code: "NOT_FOUND"`) and never
   echoes the request method/path or leaks a stack trace. Changing it requires
   updating `backend/src/__tests__/api-contract.test.ts` and
   `backend/src/middleware/__tests__/unknown-route-contract.test.ts`.
2. **Deprecation / Sunset headers** — endpoints scheduled for removal advertise
   `Deprecation`, `Sunset` and `Link: <...>; rel="deprecation"`. Declarations
   live in `API_DEPRECATIONS` (`backend/src/middleware/deprecation.ts`); the
   registry is validated at boot.
3. **Per-route rate-limit policies** — auth, read, write, admin and SSE have
   distinct, env-configurable budgets (`RATE_LIMIT_POLICIES`). See
   [Rate-limiting guidance](../rate-limiting-guidance.md).
4. **API contract tests** — `backend/src/__tests__/api-contract.test.ts` runs
   the real app against the generated OpenAPI document and fails on
   undocumented runtime response fields or lost contracts.
5. **Security declarations** — every documented operation's `security` must
   match the guard middleware on the real route. The check lives in
   `backend/src/lib/openapi-security.ts` and runs in
   `backend/src/__tests__/openapi-security.test.ts`; it fails when a
   JWT/admin-protected route is documented as public or when a public route
   claims a scheme it does not enforce.
