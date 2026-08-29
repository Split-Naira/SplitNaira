# Local Postgres Migration Dry-Run

This runbook verifies that the complete TypeORM migration history applies to a
new, disposable Postgres database. It is intended for contributors before a
migration PR and for CI; it is not a deployment command.

## Ownership and behaviour

| Concern | Owner | Current behaviour |
|---------|-------|-------------------|
| Migration source and dry-run script | Backend Engineering | `backend/scripts/run-migration-dry-run.mjs` recreates a dedicated database, then runs `typeorm migration:run`. |
| Local Postgres service | Contributor / Backend Engineering | The `postgres` service in `docker-compose.yml` provides a local Postgres 16 instance. |
| CI service and check | Platform Engineering | `.github/workflows/migration-check.yml` runs the same command against an isolated GitHub Actions service database. |

The command deliberately drops and recreates the database named in
`MIGRATION_DRY_RUN_DATABASE_URL` with `DROP DATABASE ... WITH (FORCE)`. It
never uses a regular `DATABASE_URL` as a fallback. This prevents an existing
development or deployment connection string from becoming the reset target.

> **Safety boundary:** only use a database reserved for this check. Do not
> set either migration dry-run URL to a shared, staging, or production
> database. The admin user must have permission to drop and create the target
> database.

## Prerequisites

- Node.js 18+ and npm 8+.
- Root dependencies installed with `npm ci` (or `npm install` only when you
  are intentionally changing dependencies).
- A local Postgres server reachable on `localhost:5432`. The Compose service
  is the supported quick-start option.

Start only Postgres from the repository root:

```bash
docker compose up -d postgres
docker compose ps postgres
```

The default Compose credentials are `splitnaira` / `splitnaira`. That role is
created as the Postgres superuser by the local image and can create the
disposable database below.

## Run the check

Set explicit, isolated target and admin connections. These examples use the
default Compose credentials and a database named `splitnaira_ci` that is safe
for the command to recreate.

```bash
export MIGRATION_DRY_RUN_DATABASE_URL='postgresql://splitnaira:splitnaira@localhost:5432/splitnaira_ci'
export MIGRATION_DRY_RUN_ADMIN_DATABASE_URL='postgresql://splitnaira:splitnaira@localhost:5432/postgres'
npm run migration:dry-run
```

In PowerShell, use the equivalent session-scoped variables:

```powershell
$env:MIGRATION_DRY_RUN_DATABASE_URL = 'postgresql://splitnaira:splitnaira@localhost:5432/splitnaira_ci'
$env:MIGRATION_DRY_RUN_ADMIN_DATABASE_URL = 'postgresql://splitnaira:splitnaira@localhost:5432/postgres'
npm run migration:dry-run
```

Successful output ends with:

```text
[migration:dry-run] Completed successfully.
```

The root command delegates to the backend workspace. It may also be run as
`npm run migration:dry-run -w backend` from the repository root.

### Configuration reference

| Variable | Required | Purpose |
|----------|----------|---------|
| `MIGRATION_DRY_RUN_DATABASE_URL` | Recommended | Connection URL for the database that will be dropped, recreated, and migrated. Defaults only to the local `splitnaira_ci` URL shown above. |
| `MIGRATION_DRY_RUN_ADMIN_DATABASE_URL` | Recommended | Connection URL to an existing administrative database, normally `postgres`, using a role permitted to create and drop the target database. |
| `MIGRATION_DRY_RUN_DATABASE_NAME` | Optional | Extra guard: when set, it must exactly match the database name in `MIGRATION_DRY_RUN_DATABASE_URL`. |
| `MIGRATION_DRY_RUN_ADMIN_DATABASE` | Optional | Administrative database name when an admin URL is not supplied; defaults to `postgres`. |

`MIGRATION_ADMIN_DATABASE_URL` and `MIGRATION_ADMIN_DATABASE` remain accepted
as legacy aliases, but new local and CI configuration should use the
`MIGRATION_DRY_RUN_*` names. The dry-run target cannot be `postgres`,
`template0`, or `template1`.

## Troubleshooting

| Symptom | Likely cause | Resolution |
|---------|--------------|------------|
| Connection refused on port 5432 | Postgres is not running or the port is already in use. | Run `docker compose up -d postgres`, then inspect `docker compose logs postgres`. Use URLs with the actual local port if it differs. |
| `permission denied to create database` | The admin role is not a database creator. | Use an admin URL with a role that has `CREATEDB` (the Compose `splitnaira` role does), or ask the database owner to provide a disposable target. |
| `MIGRATION_DRY_RUN_DATABASE_NAME must match` | The explicit name and target URL point at different databases. | Correct one of the values so they name the same disposable database. |
| Migration error after the reset completes | A migration cannot be applied cleanly from an empty schema. | Treat this as a migration defect: keep the failed output, fix the migration, and re-run the command. Do not mark the migration as applied manually. |

## Operational impact

The check temporarily creates schema, tables, extensions, and a `migrations`
history table in its target database, then leaves that database in place for
inspection. It does not change application data outside that target. To stop
the local service after the check, run `docker compose down`; do not add `-v`
unless you also intend to remove the Compose database volume.

## Related

- [Backend deployment](../backend-deploy.md)
- [Postgres backup and restore](./postgres-backup-restore.md)
- [Workspace command reference](../../README.md#workspace-specific-command-reference)
