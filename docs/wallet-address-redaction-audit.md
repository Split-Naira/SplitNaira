# Wallet Address Redaction Audit

**Owner**: Backend on-call + Platform/Observability  
**Cadence**: Per release, plus quarterly review  
**Last reviewed**: 2026-08-26

---

## Scope

This checklist covers every code path where Stellar public keys (`G…`) or
contract IDs (`C…`) can reach log output, error monitoring, or persisted audit
records. It does **not** cover database rows that intentionally store wallet
addresses for business logic.

---

## Current Behavior

| Layer | Mechanism | Pattern / Token | Default |
|-------|-----------|-----------------|---------|
| HTTP access logs | `morgan` format in `backend/src/index.ts` | `/\b[GC][A-Z2-7]{55}\b/g` → `[WALLET_REDACTED]` | Redacted |
| Backend Sentry | `beforeSend` in `backend/src/index.ts` | Same regex | Redacted (`SENTRY_SCRUB_WALLET_ADDRESSES=true`) |
| Frontend Sentry | `beforeSend` in `frontend/sentry.client.config.ts` | Same regex | Redacted (`NEXT_PUBLIC_SENTRY_SCRUB_WALLET_ADDRESSES=true`) |
| Winston structured logs | `scrubFormat` in `backend/src/services/logger.ts` | Field-name allowlist `SCRUB_KEYS` | **Not redacted by default** |
| Health route responses | `redactSecrets()` in `backend/src/routes/health.ts` | Connection-string credential patterns | Not applicable |
| RPC retry logs | `sanitizeRpcErrorMessage()` in `backend/src/services/stellar.ts` | Secret seeds, XDR, hex keys; public keys preserved for ops triage | Preserved (intentional) |
| Admin audit log | `backend/src/middleware/audit-log.ts` | Raw request payload persisted to `audit_log.payload` | Persisted as-is |

---

## Checklist

### A. Winston Structured Logs

- [ ] `walletAddress`, `recipient`, `source_account`, `contract_id`,
      `simulator_account`, and any other field that may hold a `G…`/`C…`
      value are listed in `SCRUB_KEYS` (`backend/src/services/logger.ts`).
- [ ] `scrubSecrets()` traverses nested objects so wallet addresses in
      sub-objects are also redacted.
- [ ] At least one unit test verifies that a logged object containing a
      `walletAddress` field emits `[REDACTED]` instead of the raw key.
- [ ] Search `backend/src/**/*.ts` for `logger.{info,warn,error,debug}` calls
      that include wallet-address fields and confirm they go through the
      Winston pipeline (not `console.*`).

### B. HTTP Access Logs

- [ ] `morgan` middleware applies `scrubWalletAddresses()` to the URL token
      before the line is emitted.
- [ ] Query strings, path parameters, and request bodies that contain wallet
      addresses are covered. (Note: morgan logs URLs; bodies are not in access
      logs by default.)
- [ ] If a reverse proxy or load balancer adds its own access logs, verify
      those sinks also redact wallet addresses or do not receive them.

### C. Sentry / Error Monitoring

- [ ] `SENTRY_SCRUB_WALLET_ADDRESSES` is documented in `docs/backend-deploy.md`
      and `SECURITY.md` with its default (`true`).
- [ ] `NEXT_PUBLIC_SENTRY_SCRUB_WALLET_ADDRESSES` is documented with its
      default (`true`).
- [ ] `beforeSend` hooks use the anchored regex `/\b[GC][A-Z2-7]{55}\b/g`
      so contract IDs and public keys are both caught.
- [ ] Tests exist that send a mock event containing a wallet address through
      `beforeSend` and assert the emitted payload contains
      `[WALLET_REDACTED]`.

### D. RPC Retry Logs

- [ ] `sanitizeRpcErrorMessage()` redacts secret seeds (`S…`), XDR blobs,
      and hex key material.
- [ ] Public keys are intentionally preserved for ops triage; this exception
      is documented in the function comment and in `docs/runbooks/observability.md`.
- [ ] No call site logs the full `error` object or raw request/response bodies
      in retry paths (bypasses the sanitizer).

### E. Admin Audit Log

- [ ] Decision documented: whether `audit_log.payload` should retain raw
      wallet addresses for forensics or redact them before persistence.
- [ ] If redaction is required, `audit-log.ts` redacts wallet addresses from
      the payload before `repository.save(entry)`.
- [ ] If raw values are retained, access to the `audit_log` table is restricted
      to the admin role and the retention period is documented in `docs/secrets.md`.

### F. Frontend Console Logs

- [ ] No `console.log` / `console.warn` / `console.error` call in
      `frontend/src/` emits a raw wallet address.
- [ ] Frontend Sentry `beforeSend` is the only client-side sink that may
      receive wallet addresses, and it redacts them by default.

### G. CI / Supply Chain

- [ ] No workflow step echoes wallet addresses to GitHub Actions logs.
- [ ] No artifact (bundle, coverage report, debug log) published by CI contains
      an unredacted wallet address.
- [ ] If logs are shipped to an external drain (Render, Datadog, Loki),
      verify the drain configuration inherits the same redaction rules.

### H. Documentation

- [ ] This checklist is linked from `SECURITY.md` and
      `docs/runbooks/cicd-security.md`.
- [ ] `docs/backend-deploy.md` documents the `SENTRY_SCRUB_WALLET_ADDRESSES`
      toggle.
- [ ] Any exception to redaction (e.g. ops triage need for public keys in RPC
      logs) is recorded in `docs/runbooks/observability.md`.

---

## Remediation Quick Reference

| Gap | Fix location | Effort |
|-----|-------------|--------|
| `walletAddress` not in Winston `SCRUB_KEYS` | `backend/src/services/logger.ts` | 5 min |
| Missing logger redaction test | `backend/src/__tests__/logger.test.ts` | 15 min |
| Audit log retains raw wallet addresses | `backend/src/middleware/audit-log.ts` | 30 min |
| Frontend `console.*` leaks wallet addresses | `frontend/src/` call sites | 10 min per site |

---

## Operational Impact

- Enabling wallet-address redaction in Winston logs does **not** change API
  responses or database schema.
- Redaction in Sentry can be disabled with an environment variable for
  debugging; default is on.
- If audit-log payload redaction is introduced, verify that incident-response
  procedures that query `audit_log` still have the data they need, or adjust
  those runbooks.

---

## References

- `backend/src/services/logger.ts`
- `backend/src/index.ts`
- `backend/src/middleware/audit-log.ts`
- `backend/src/services/stellar.ts`
- `frontend/sentry.client.config.ts`
- `docs/backend-deploy.md`
- `docs/runbooks/observability.md`
- `docs/runbooks/cicd-security.md`
- `SECURITY.md`
