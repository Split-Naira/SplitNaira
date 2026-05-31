# Frontend Deployment Runbook

## Pre-deploy

- Tests pass
- Build succeeds
- Env vars validated

## Deploy

npm run build

Upload dist/

## Verify

- Homepage loads
- Login works
- API connectivity verified

## Rollback

Redeploy previous build artifact