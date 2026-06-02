# SplitNaira Backend

Express + TypeScript API scaffold for SplitNaira.

## Scripts
- `npm ci`
- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run test`
- `npm run deps:check`
- `npm run generate:openapi` - Regenerates the OpenAPI specification

## OpenAPI
The API documentation is defined using Zod schemas and generated into an OpenAPI 3.0 specification.
- Source: `src/openapi.ts`
- Output: `openapi/openapi.yaml`
- Command: `npm run generate:openapi`

## Notes
- Dependencies are pinned to exact versions in `package.json` and `package-lock.json`.
- Use `npm ci` to install and keep lockfile-based resolution deterministic across local and CI.
- Run `npm run deps:check` before opening a PR to catch peer graph or lockfile health issues early.
- Propose backend toolchain upgrades in focused PRs and commit lockfile + manifest together.
- Copy `.env.example` to `.env` and fill in Stellar config before wiring endpoints.

## Deployment
- CI/CD workflow: `../.github/workflows/backend-deploy.yml`
- Deployment configuration and required secrets: [`../docs/backend-deploy.md`](../docs/backend-deploy.md)
- **Release Operations (Wave 5)**: [`../docs/backend-release-ops-wave5.md`](../docs/backend-release-ops-wave5.md) — deployment checklist, rollback notes, and local CI steps.

## Release operations & production readiness

- **Database transaction safety** — user registration runs inside `withTransaction()` with automatic rollback
- **Structured logging** — critical paths use Winston with `requestId`
- **Analytics & insights** — Prometheus metrics for HTTP request volumes, latency, inflight request gauges, and validation failures
- **Input validation** — `validateRequest` middleware returns consistent 400 payloads
- **Error handling** — centralized `AppError` mapping and RPC retry policy
- **Rate limiting** — layered limits on all route groups
- **Payments admin hardening** — `/splits/admin/*` can be protected with `PAYMENTS_ADMIN_API_KEY`, and write actions can be frozen instantly with `PAYMENTS_ADMIN_WRITE_ENABLED=false`

The backend includes comprehensive production-grade hardening:

- **Database transaction safety** — Critical operations (`withTransaction()`) with automatic rollback prevent data corruption
- **Structured logging** — Winston logger with `requestId` correlation across all requests
- **Input validation** — Zod schemas on all routes with consistent 400 error responses
- **Error handling** — Centralized `AppError` mapping with user-friendly remediation hints
- **Rate limiting** — Layered per-endpoint limits (global, read, write, admin)
- **Response validation** — Middleware validates all JSON responses match schemas
- **Security headers** — Helmet.js for CSP, HSTS, X-Frame-Options, etc.
- **Payments admin hardening** — `/splits/admin/*` protected by `PAYMENTS_ADMIN_API_KEY`; writes toggleable via `PAYMENTS_ADMIN_WRITE_ENABLED`

**Documentation**:
- [`../docs/PLATFORM_HARDENING_IMPLEMENTATION.md`](../docs/PLATFORM_HARDENING_IMPLEMENTATION.md) — implementation details, monitoring, and rollback
- [`../docs/PLATFORM_HARDENING_DEPLOYMENT_CHECKLIST.md`](../docs/PLATFORM_HARDENING_DEPLOYMENT_CHECKLIST.md) — operator checklist for safe deployment
- [`../docs/backend-release-ops-wave5.md`](../docs/backend-release-ops-wave5.md) — deployment procedures and CI commands

### Transaction Safety Example

All database writes use `withTransaction()` for atomicity:

```typescript
const user = await withTransaction(async (queryRunner) => {
  const repo = queryRunner.manager.getRepository(User);
  const existing = await repo.findOne({ where: { walletAddress } });
  if (existing) throw new Error("User exists");
  
  const newUser = repo.create({ walletAddress, email });
  return await repo.save(newUser);
});
// Automatically rolled back on error — no orphaned records
```

### Testing

Run tests to verify hardening:

```bash
npm test -- error-scenarios.test.ts    # Validation & error handling
npm test -- transaction-safety.test.ts # Database transaction rollback
npm test                                # All tests
```

## Structure
- `src/index.ts` - App entry
- `src/routes` - HTTP routes
- `src/services` - Stellar/Soroban integrations
- `src/middleware` - Error handling, validation, rate limiting
- `src/__tests__` - Comprehensive test suites including error scenarios
