# Distribution Remainder Accounting

How the SplitNaira contract handles integer rounding when it splits a project balance by basis points. This page covers what the contract guarantees, the edge cases, and what off-chain code (frontend previews, backend, indexers, reconciliation) has to match.

- **Owner:** contracts workspace (`contracts/lib.rs`: `distribute`, `claim`)
- **Related:** [contracts/README.md](../contracts/README.md), [split_calculation_helpers.md](split_calculation_helpers.md), [contract-events.md](contract-events.md)

## Why remainders exist

Balances are integer stroops (`i128`), and shares are basis points (`bps`) out of `10_000`. A collaborator's exact share, `balance × bps / 10_000`, is usually not a whole number. Integer division always rounds down, so a pure per-collaborator floor leaves some stroops unassigned. These leftover stroops are called the *remainder* or *dust*.

## The rule (`distribute`)

For a project with `n` collaborators, taken in stored order `c₀ … cₙ₋₁`:

```
paid(cᵢ)   = floor(balance × bpsᵢ / 10_000)        for i < n−1
paid(cₙ₋₁) = balance − Σ paid(c₀ … cₙ₋₂)           (last collaborator takes the remainder)
```

- The **last collaborator in stored order** receives the remainder. That is the order the owner used when the project was created or last reordered with `update_collaborators`, not the collaborator with the largest share.
- The remainder added to the last collaborator is `Σ frac(balance × bpsᵢ / 10_000)` over all `n` shares. It is a whole number in the range `0 … n−1` stroops. In other words, the last collaborator never gets more than `n−1` stroops above its own floored share.
- No stroops are left over after a round: `ProjectBalance` is set to `0` after every successful `distribute`.

### Worked example

This mirrors `test_upgrade_regression_distribution_preserves_rounding_and_accounting_invariants` in `contracts/tests.rs`. It uses 3 collaborators at 3333 / 3333 / 3334 bps.

| Round | Balance | Alice (3333) | Bob (3333) | Carol (3334, last) | Carol's own floor | Remainder to Carol |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 101 | 33 | 33 | **35** | 33 | +2 (= n−1, the maximum) |
| 2 | 10,003 | 3,333 | 3,333 | **3,337** | 3,335 | +2 |
| **Total** | 10,104 | 3,366 | 3,366 | 3,372 | | |

After round 2: `total_distributed = 10,104`, `distribution_round = 2`, `get_balance = 0`, and the three `get_claimed` values add up to `total_distributed`.

## Accounting invariants

Every successful `distribute` keeps the following true. Changing any of them is a compatibility break (see [contracts/README.md § Regression Guarantees](../contracts/README.md#regression-guarantees)):

1. `Σ paid(cᵢ) == balance`: the round pays out exactly the project balance.
2. `ProjectBalance` becomes `0`.
3. `total_distributed` increases by exactly `balance`.
4. `distribution_round` increases by exactly 1, and never changes when `distribute` fails.
5. `Claimed(project, cᵢ)` increases by `paid(cᵢ)`. Summed over all collaborators, `get_claimed` equals `total_distributed` for projects paid only through `distribute`.
6. The contract's accounted token balance goes down by `balance`, so `get_unallocated_balance` does not change. Rounding never creates unallocated funds.
7. The rule gives the same result however the balance was built up. Paying out after N deposits gives each collaborator exactly what a single deposit of the same total would, because only the total balance goes into the calculation.

## Edge cases

### Balance smaller than the collaborator count
`distribute` returns `NoBalance` when `balance < n`, and nothing changes. Deposits keep adding to the balance until it reaches `n`.

> This guard sets a minimum balance. It does **not** promise every collaborator a non-zero payout. A small share can still round down to `0`. Example: balance `3` with shares `9998 / 1 / 1` pays `2 / 0 / 1`.

### Zero-amount shares are skipped
If a collaborator's computed amount is `0`, the contract sends no transfer, emits no `payment_sent` event and leaves that collaborator's `Claimed` entry unchanged. The round still counts (`distribution_round` increases). Indexers must **not** assume one `payment_sent` event per collaborator per round. Rebuild a round from `distribution_complete.total` and the `payment_sent` events that are actually present.

### Reordering collaborators
`update_collaborators` can change which collaborator is last, and so who receives future remainders. Past rounds are unaffected.

## Interaction with `claim` (pull payouts)

`claim` handles remainders differently from `distribute`:

- It pays `floor(current_balance × bps / 10_000)` to the caller alone. **No remainder is assigned.** The rounded-off dust stays in `ProjectBalance` and goes out in the next `distribute`.
- It increases `total_distributed` and the claimer's `Claimed` entry, but **not** `distribution_round`.

> **Known limitation:** `claim` works out the share from the balance *as it is at the time of the claim*, not from what the collaborator was entitled to when funds were deposited. Earlier claims lower the pool that later claims are calculated from. So pulled payouts depend on the order of claims, and they don't match the push (`distribute`) split. Example: 50/50 split, balance 8,000,000. Alice claims 4,000,000, which leaves 4,000,000. Bob's claim then pays 2,000,000, not 4,000,000. The remaining 2,000,000 stays in the pool and goes out in the next `distribute` using the normal rule. (`test_claim_reduces_project_balance` pins the first half of this.) Until entitlement-based claim accounting ships, treat `distribute` as the authoritative split and `claim` as a partial, order-dependent advance.

## Guidance for off-chain code

- **Preview math must follow the contract.** Any UI or API that shows expected payouts must use floor for every collaborator except the last in stored order, and give the last collaborator `balance − Σ others`. Rounding each share to the nearest stroop, or computing percentages as floats, will disagree with the chain by up to `n−1` stroops.
- **Reconciliation:** compare `total_distributed` with the `distribution_complete.total` values (plus `collaborator_claimed.amount` for pull payouts). Don't compare it with Σ of `bps × deposits`, which will be off by the rounding.
- **Display:** a remainder of up to `n−1` stroops (at most `0.0000001 × (n−1)` of a 7-decimal token) is expected and is not a discrepancy. Don't raise alerts for it.

## Where this is tested

| Behaviour | Test |
| --- | --- |
| Remainder to last collaborator across rounds, full accounting | `tests.rs::test_upgrade_regression_distribution_preserves_rounding_and_accounting_invariants` |
| `NoBalance` when `balance < n` / zero balance | `reliability_tests.rs::test_distribute_zero_balance_returns_no_balance` |
| Claim reduces pooled balance | `tests.rs::test_claim_reduces_project_balance` |
