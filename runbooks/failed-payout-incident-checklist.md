# Failed Payout Distribution Round — Incident Checklist

Issue #1074. Use this checklist when a distribution round fails or reports
partial completion.

## 1. Triage
- [ ] Note the split ID, round ID, and timestamp of the failure.
- [ ] Check contract state: is the round marked `failed`, `partial`, or
      still `in_progress` on-chain?
- [ ] Check Soroban RPC status/health for the network used by the round.
- [ ] Check backend logs for the distribution job (errors, timeouts, retries).

## 2. Decide: retry or escalate
- [ ] Retry if the failure is a transient RPC/network error and no funds
      were partially disbursed.
- [ ] Escalate to on-call engineering if funds were partially disbursed,
      the contract state is inconsistent, or the same round has already
      failed once.

## 3. User communications
- [ ] If recipients are affected, post a status update per
      `docs/RELEASE_RUNBOOK.md` communication guidelines.
- [ ] Record the incident summary once resolved for postmortem.

## 4. Resolution
- [ ] Confirm final on-chain round status matches backend records.
- [ ] Link this checklist run in the incident ticket.
