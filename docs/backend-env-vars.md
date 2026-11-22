# Backend Environment Variables

This document maps each backend environment variable to its owner area, the
environments it applies to, and whether it is secret or public config. See
`backend/.env.example` for the canonical list of variables and defaults.

Related docs:

- [`secrets.md`](./secrets.md) - full secret inventory, storage, and rotation procedures
- [`environments.md`](./environments.md) - dev/staging/production configuration matrix

| Variable                              | Owner Area          | Required Environments         | Secret?    | Notes                                                                                                                                                                   |
| ------------------------------------- | ------------------- | ----------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PORT                                  | Backend             | dev, staging, prod            | Public     | Defaults to 3001                                                                                                                                                        |
| CORS_ORIGIN                           | Backend/Security    | dev, staging, prod            | Public     | Must be explicit origins in production; wildcard rejected. See environment matrix in `environments.md`                                                                  |
| LOG_LEVEL                             | Backend             | dev, staging, prod            | Public     | Controls log verbosity                                                                                                                                                  |
| LOG_FORMAT                            | Backend             | dev, staging, prod            | Public     | `json` in prod for log drains, `pretty` in dev                                                                                                                          |
| DATABASE_URL                          | Backend/Infra       | dev, staging, prod            | **Secret** | See `secrets.md` for rotation procedure                                                                                                                                 |
| HORIZON_URL                           | Backend/Contracts   | dev, staging, prod            | Public     | Stellar Horizon endpoint                                                                                                                                                |
| SOROBAN_RPC_URL                       | Backend/Contracts   | dev, staging, prod            | Public     | Must match network per `environments.md`                                                                                                                                |
| SOROBAN_NETWORK_PASSPHRASE            | Backend/Contracts   | dev, staging, prod            | Public     | Network identifier                                                                                                                                                      |
| CONTRACT_ID                           | Backend/Contracts   | dev, staging, prod            | Public     | Must match deployed contract per `environments.md`                                                                                                                      |
| SIMULATOR_ACCOUNT                     | Backend/Contracts   | dev, staging (rarely prod)    | Public     | Used for simulation only                                                                                                                                                |
| SENTRY_DSN                            | Backend/Monitoring  | staging, prod (optional)      | **Secret** | Leave blank to disable Sentry; see `secrets.md`                                                                                                                         |
| SENTRY_ENVIRONMENT                    | Backend/Monitoring  | staging, prod (optional)      | Public     | Tags errors by environment                                                                                                                                              |
| SENTRY_SCRUB_WALLET_ADDRESSES         | Backend/Monitoring  | staging, prod (optional)      | Public     | Privacy control for error reports                                                                                                                                       |
| PAYMENTS_ADMIN_API_KEY                | Backend/Payments    | prod (required), staging      | **Secret** | Protects `/splits/admin` routes; see `secrets.md` for rotation and approval process                                                                                     |
| PAYMENTS_ADMIN_WRITE_ENABLED          | Backend/Payments    | prod, staging                 | Public     | Kill-switch to freeze admin payout routes without redeploy; changes require team awareness                                                                              |
| STRICT_RESPONSE_VALIDATION            | Backend             | dev, staging, prod (optional) | Public     | Defaults `true` in prod                                                                                                                                                 |
| READ_CACHE_TTL_MS                     | Backend/Performance | dev, staging, prod (optional) | Public     | Cache tuning                                                                                                                                                            |
| READ_CACHE_MAX_ENTRIES                | Backend/Performance | dev, staging, prod (optional) | Public     | Cache tuning                                                                                                                                                            |
| DATABASE_POOL_MAX                     | Backend/Performance | dev, staging, prod (optional) | Public     | DB connection pool size                                                                                                                                                 |
| PENDING_PAYOUT_ALERT_WARNING_MINUTES  | Backend/Payments    | staging, prod (optional)      | Public     | Overrides the network default warning age for `npm run alert:pending-payouts` (#1642). Must be at least the 6-minute submission window. See `runbooks/stuck-payouts.md` |
| PENDING_PAYOUT_ALERT_CRITICAL_MINUTES | Backend/Payments    | staging, prod (optional)      | Public     | Overrides the network default critical age for pending payout alerts. Must be above the warning threshold                                                               |
| EMAIL_VERIFICATION_RESEND_COOLDOWN_MS | Backend/Auth        | dev, staging, prod (optional) | Public     | Per-email wait between verification email sends. Defaults to `60000`; invalid or non-positive values fall back to the default. See `auth-email-flows.md`                |
| EMAIL_VERIFICATION_TOKEN_TTL          | Backend/Auth        | dev, staging, prod (optional) | Public     | Lifetime of email verification links. Defaults to `24h`                                                                                                                 |
| EMAIL_CHANGE_TOKEN_TTL                | Backend/Auth        | dev, staging, prod (optional) | Public     | Lifetime of email change confirmation links (#1448). Defaults to `24h`                                                                                                  |
| EMAIL_CHANGE_URL_BASE                 | Backend/Auth        | dev, staging, prod (optional) | Public     | Page the email change confirmation link opens. Defaults to `https://app.splitnaira.com/confirm-email-change`                                                            |
| EMAIL_VERIFICATION_URL_BASE           | Backend/Auth        | staging, prod (optional)      | Public     | Frontend page the verification link points to. Defaults to `https://app.splitnaira.com/verify-email`                                                                    |

## Secret vs Public Config

Variables marked **Secret** above must never be committed to source control and
must be stored in an approved secret store (GitHub Actions secrets, Render
environment secrets, etc.). Full policy and rotation steps live in
[`secrets.md`](./secrets.md).

All other variables are **Public** - safe to expose in build logs or
client-visible config, no special handling needed.

## Rotation & Change Approval

- **DATABASE_URL** and **SENTRY_DSN**: follow the general rotation procedure in
  [`secrets.md`](./secrets.md).
- **PAYMENTS_ADMIN_API_KEY**: requires sign-off before rotation, since it
  protects admin payout and allowlist mutation routes. Coordinate with whoever
  manages `/splits/admin`. See [`secrets.md`](./secrets.md) for the general
  process.
- **PAYMENTS_ADMIN_WRITE_ENABLED**: not a secret, but toggling it in production
  is a functional change (freezes payout routes) - treat changes as requiring
  team awareness, not just a config edit.
- For which values are expected per environment (dev/staging/prod), see the
  matrix in [`environments.md`](./environments.md).

## Env Examples

- Backend: [`backend/.env.example`](../backend/.env.example)
- Frontend: [`frontend/.env.example`](../frontend/.env.example)
