---
name: Deploy Checklist
about: Pre-release checklist for maintainers before approving a deploy
title: "[Deploy] <version> — pre-release checklist"
labels: deploy, high priority
assignees: ''
---

## Deploy Checklist — SplitNaira

Link the PR this deploy is based on: <!-- #PR_NUMBER -->

### Code Quality
- [ ] All CI checks pass (lint, type-check, tests)
- [ ] No `console.log` / debug artifacts in diff
- [ ] `npm audit` shows no critical/high CVEs in new dependencies

### Contracts
- [ ] Contract changes audited for re-entrancy and overflow
- [ ] Migration/upgrade plan documented if contract state changes
- [ ] Rollback path for contract upgrade is defined

### Database / State
- [ ] Schema migrations are forward-compatible (no destructive column drops)
- [ ] Migration tested against a staging DB snapshot
- [ ] Rollback migration script exists and tested

### Observability
- [ ] New error paths emit structured logs
- [ ] Critical flows have success/failure metrics
- [ ] Analytics/metrics endpoint validated by CI/CD smoke checks
- [ ] Runbook updated if on-call response changes

### Release Readiness
- [ ] `docs/release-readiness-checklist.md` items verified
- [ ] Changelog entry added
- [ ] Environment variables for new features documented in `.env.example`
- [ ] Feature flags set correctly for staged rollout (if applicable)

### Sign-off
- [ ] Reviewed by at least one maintainer
- [ ] Approved by `@Split-Naira` org member with deploy access
