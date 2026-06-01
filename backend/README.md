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
- **Input validation** — `validateRequest` middleware returns consistent 400 payloads
- **Error handling** — centralized `AppError` mapping and RPC retry policy
- **Rate limiting** — layered limits on all route groups
- **Payments admin hardening** — `/splits/admin/*` can be protected with `PAYMENTS_ADMIN_API_KEY`, and write actions can be frozen instantly with `PAYMENTS_ADMIN_WRITE_ENABLED=false`

See [`../docs/backend-release-ops-wave5.md`](../docs/backend-release-ops-wave5.md) for the implementation plan, deploy/rollback runbook, and CI commands.

## Structure
- `src/index.ts` - App entry
- `src/routes` - HTTP routes
- `src/services` - Stellar/Soroban integrations
- `src/middleware` - Error handling
