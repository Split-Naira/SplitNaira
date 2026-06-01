# CI/CD Incident Management Runbook (#520)

## Purpose

This runbook captures the operational response for CI/CD incidents affecting SplitNaira deployments, builds, and release automation.
It complements the existing CI/CD reliability, security, and observability runbooks by focusing on incident detection, triage, rollback, and post-incident recovery.

## Incident classes

1. **Pipeline incident** — CI job failure, dependency audit failure, or workflow misconfiguration.
2. **Deployment incident** — backend deploy hook failure, Render deployment rollback, or smoke check failure.
3. **Production runtime incident** — live service outages, readiness probe failures, or contract/state corruption detected after deploy.

## Detection

- `ci.yml` failures block merges and prevent unsafe code reaching `main`.
- `backend-deploy.yml` waits for successful `CI` workflow completion before triggering a deploy.
- `mainnet-deploy.yml` is manual and gated by production deploy config validation.
- Post-deploy smoke checks run when `BACKEND_SMOKE_URL` is configured; failures are the primary deploy incident signal.
- Health probes and Sentry alerts are the primary runtime incident signals in production.

## Triage

### CI pipeline incident

1. Review the failed job output in GitHub Actions.
2. Identify whether the failure is:
   - data integrity / generated artifact drift
   - type/lint/build failure
   - backend compatibility or contract test failure
   - dependency/security audit failure
3. Reproduce locally using the same command from the failing job.
4. Fix the root cause and rerun the workflow before merging.

### Deploy incident

1. Check the GitHub Actions deploy workflow logs.
2. If the Render hook failed, examine the hook response and Render dashboard.
3. If the smoke check failed:
   - do not promote the deployment
   - roll back to the previous stable Render revision if available
   - if rollback is not immediately possible, restore traffic using the previous backend environment/state
4. Confirm `GET /health/ready` returns healthy on the recovered instance.

### Production runtime incident

1. Collect `x-correlation-id` or request ID from the failing request.
2. Search logs in Render and Sentry for matching IDs.
3. Validate the health endpoint component breakdown for DB/RPC/contract failures.
4. If the incident is caused by a recent deployment, roll back that deployment and verify traffic recovery.

## Containment and rollback

- Use Render’s previous revision rollback feature whenever a deploy or runtime regression is detected.
- If a config-only issue is identified (for example, invalid `CONTRACT_ID` or `CORS_ORIGIN`), revert the environment change and redeploy the last known good commit.
- If a code regression is identified, revert the PR and rerun the deploy workflow after the rollback is confirmed.
- For contract state or Soroban-specific incidents, follow the contract incident procedures in `docs/contract-release-and-upgrade-runbook.md`.

## Recovery

1. Verify the recovered deployment passes smoke checks.
2. Confirm the service is healthy via `/health/ready` and, if enabled, `/metrics` for traffic and error rates.
3. Confirm no open errors remain in Sentry for the restored revision.
4. Notify stakeholders that the incident is contained and monitoring is stable.

## Post-incident review

- Document the root cause and corrective action in the associated issue or incident ticket.
- Update this runbook or related docs if the incident reveals a gap in CI/CD checks, deploy gating, or rollback procedures.
- If the incident originated from a workflow failure, add a regression test or workflow validation step as needed.

## Operational impact

- CI failures are treated as pre-release incidents and block promotion to deploy workflows.
- Deploy workflow incidents are treated as safe-stop events; smoke check failures must be investigated before continuing.
- Production runtime incidents require immediate rollback if the problem correlates with a recent deployment or environment change.

## Related

- [CI/CD data integrity](./ci-data-integrity.md)
- [CI/CD security](./cicd-security.md)
- [Observability](./observability.md)
- [Backend deploy](../backend-deploy.md)
- [Deployment runbook](../deployment.md)
