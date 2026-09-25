## Reliability Improvements (Wave 5)

### Changes
- Added `reliability_tests.rs` with edge-case tests:
  - `distribute` on missing project returns `NotFound`
  - `get_balance` on missing project returns `NotFound`
  - Collaborator with zero basis points returns `ZeroShare`

### Running
```
cargo test --locked
```

### Rollback
Delete `contracts/reliability_tests.rs`.

## Property Tests: Repeated Deposits Before Distribution

`deposit_property_tests.rs` checks the deposit → distribute path against 48
randomly generated cases per property: 2–5 collaborators with random
basis-point splits, 1–16 deposits, and amounts up to 1,000 tokens. The PRNG is
seeded, so runs are deterministic and need no extra crates.

Properties checked:
- Repeated deposits add up exactly in the project balance, the contract token
  balance and the accounted balance. `get_unallocated_balance` stays `0`, and
  the round, total distributed and claimed amounts stay at zero until
  `distribute` is called.
- Distributing after N deposits pays each collaborator the same amount as one
  deposit of the same total. The last collaborator gets the rounding
  remainder, and the balance ends at zero.
- When deposits into two projects that share a token are interleaved, funds
  never move between the projects.
- If the balance is smaller than the number of collaborators, `distribute`
  returns `NoBalance`. Deposits still add up until distribution becomes
  possible.

### Running
```
cargo test --features testutils deposit_property_tests
# explore new cases; failures print the case seed
SPLITNAIRA_PROPTEST_SEED=42 cargo test --features testutils deposit_property_tests
```

### Rollback
Delete `contracts/deposit_property_tests.rs` and its `mod` line in `lib.rs`.
