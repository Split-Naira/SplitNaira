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