# Contract Storage Layout and Migrations

This document specifies the persistent storage layout, key-value schemas, upgrade compatibility rules, and migration procedures for the SplitNaira smart contracts (`contracts/lib.rs`).

---

## 1. Storage Architecture Overview

SplitNaira is built on the Stellar Soroban smart contract framework. All persistent state is managed via Soroban's `env.storage().persistent()` interface.

### Storage Characteristics

| Parameter | Value | Description |
|-----------|-------|-------------|
| **Storage Type** | `persistent()` | Retained across contract invocations and subject to state expiration (TTL). |
| **TTL Threshold** | `50,000` ledgers (`PROJECT_TTL_THRESHOLD_LEDGERS`) | If remaining TTL falls below this threshold, contract calls proactively extend it. |
| **TTL Extension Bump** | `100,000` ledgers (`PROJECT_TTL_BUMP_LEDGERS`) | State is extended to survive at least ~5.8 days (at 5s/ledger close time) on every interaction. |
| **Automatic Extension** | Enabled on read/write | Any call to `create_project`, `update_project_metadata`, `update_collaborators`, `lock_project`, `deposit`, `distribute`, `claim`, `get_project`, or `get_claimable` extends the TTL for associated records. |

---

## 2. Storage Key Inventory and Schemas

All storage entries are keyed by the `DataKey` enum defined in `contracts/lib.rs`.

```rust
#[contracttype]
pub enum DataKey {
    Project(Symbol),
    ProjectBalance(Symbol),
    Claimed(Symbol, Address),
    LastClaimAmount(Symbol, Address),
    ProjectCount,
    ProjectIds,
    ProjectIdsBucket(u32),
    ProjectIdsBucketCount,
    Admin,
    AllowedTokenCount,
    AllowedTokenList,
    AllowedToken(Address),
    AccountedTokenBalance(Address),
    DistributionsPaused,
    MaxCollaborators,
}
```

### Detailed Key Specification

| Key Enum Variant | Value Type | Purpose | Mutator Methods | Reader Methods |
|---|---|---|---|---|
| `DataKey::Project(Symbol)` | `SplitProject` | Full project configuration, collaborators, and metadata. Keyed by `project_id`. | `create_project`, `update_project_metadata`, `update_collaborators`, `lock_project`, `distribute`, `claim` | `get_project`, `get_all_projects`, `get_projects_page` |
| `DataKey::ProjectBalance(Symbol)` | `i128` | Current available undistributed balance for the project (in stroops). | `deposit`, `distribute`, `claim`, `update_collaborators` | `get_project_balance` |
| `DataKey::Claimed(Symbol, Address)` | `i128` | Cumulative payout amount distributed/claimed by a collaborator for a specific project. | `distribute`, `claim` | `get_claimable` |
| `DataKey::LastClaimAmount(Symbol, Address)` | `i128` | Payout amount from the most recent self-service `claim` invocation for this collaborator. | `claim` | `get_claimable` |
| `DataKey::ProjectCount` | `u32` | Total number of projects created across contract lifetime. | `create_project` | `get_project_count` |
| `DataKey::ProjectIds` | `Vec<Symbol>` | *(Deprecated)* Flat project ID list from v1. Preserved for backward-compatible fallback reads. | *None (read-only fallback)* | `get_project_ids` (legacy fallback) |
| `DataKey::ProjectIdsBucket(u32)` | `Vec<Symbol>` | Bucketed project ID index (`PROJECT_ID_BUCKET_SIZE = 100`) for memory-efficient paginated discovery. | `create_project` | `get_projects_page`, `get_project_ids_page` |
| `DataKey::ProjectIdsBucketCount` | `u32` | Number of allocated project ID buckets. | `create_project` | `get_projects_page` |
| `DataKey::Admin` | `Address` | Super-admin address authorized to manage token allowlist, collaborator cap, and emergency pause. | `set_admin` | `get_admin` |
| `DataKey::AllowedTokenCount` | `u32` | Total number of currently allowlisted token contracts. | `allow_token`, `disallow_token` | `get_allowed_token_count` |
| `DataKey::AllowedTokenList` | `Vec<Address>` | Ordered vector of all allowlisted token contract addresses. | `allow_token`, `disallow_token` | `get_allowed_tokens` |
| `DataKey::AllowedToken(Address)` | `bool` | Fast $O(1)$ membership check for whether a token address is allowed. | `allow_token`, `disallow_token` | `is_token_allowed` |
| `DataKey::AccountedTokenBalance(Address)` | `i128` | Aggregate sum of all project balances for a given token. Used to calculate unallocated funds (`contract_balance - accounted_balance`). | `deposit`, `distribute`, `claim` | `get_unallocated_balance`, `withdraw_unallocated` |
| `DataKey::DistributionsPaused` | `bool` | Emergency circuit breaker. When `true`, halts all `distribute` and `claim` operations. | `pause_distributions`, `unpause_distributions` | `is_distributions_paused` |
| `DataKey::MaxCollaborators` | `u32` | Configurable per-project collaborator cap (`MIN = 2`, `MAX = 200`). If unset, defaults to `50` (`DEFAULT_MAX_COLLABORATORS`). | `set_max_collaborators` | `get_max_collaborators` |

---

## 3. Data Structure Schemas

### `SplitProject`

```rust
#[contracttype]
#[derive(Clone, Debug)]
pub struct SplitProject {
    pub project_id: Symbol,          // Unique identifier (max 32 alphanumeric characters)
    pub title: String,               // Human-readable title (max 200 characters)
    pub project_type: String,        // Category (e.g., "music", "film", "art", "podcast", "book", "other")
    pub token: Address,              // Stellar token contract address (must be allowlisted)
    pub owner: Address,              // Project creator / administrator address
    pub collaborators: Vec<Collaborator>, // List of collaborators and basis points
    pub locked: bool,                // If true, collaborator shares and token cannot be modified
    pub total_distributed: i128,     // Cumulative stroops distributed to collaborators
    pub distribution_round: u32,     // Number of completed distribution rounds
}
```

### `Collaborator`

```rust
#[contracttype]
#[derive(Clone, Debug)]
pub struct Collaborator {
    pub address: Address,            // Stellar wallet address of collaborator
    pub alias: String,               // Display name (max 100 characters)
    pub basis_points: u32,           // Share in basis points (1 bp = 0.01%, sum must equal 10,000)
}
```

### `ClaimableInfo`

```rust
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ClaimableInfo {
    pub claimed: i128,               // Total cumulative claimed stroops
    pub distribution_round: u32,     // Latest distribution round counter
    pub last_claim_amount: i128,     // Amount paid during most recent claim
}
```

---

## 4. Upgrade Compatibility Rules

When deploying WASM upgrades to an active contract instance on testnet or mainnet, adhere to the following backward-compatibility rules:

### Rule 1: Never Reorder or Reassign `DataKey` Enum Variants
Soroban serializes enum variants based on symbol names and types.
- **Allowed:** Adding new variants at the end of `DataKey`.
- **Forbidden:** Renaming, removing, or reordering existing enum variants.
- **Forbidden:** Changing the type of payload attached to an existing variant (e.g. changing `DataKey::Project(Symbol)` to `DataKey::Project(u64)`).

### Rule 2: Additive Key Policy and Sensible Defaults
New features must treat missing storage keys gracefully:
- When a new key is introduced (e.g., `DataKey::MaxCollaborators`), contract code must verify `env.storage().persistent().get(&key)` and fall back to the default constant (`DEFAULT_MAX_COLLABORATORS = 50`) if `None`.
- Never assume an existing deployed contract has new keys populated without an explicit admin transaction or initialization handler.

### Rule 3: Struct Layout Immutability
Soroban binary serialization of structs (`#[contracttype]`) requires field compatibility:
- **Forbidden:** Deleting or renaming existing fields in `SplitProject` or `Collaborator`.
- **Allowed:** Introducing a new struct version (e.g., `SplitProjectV2`) along with an explicit migration function if field additions are mandatory.

### Rule 4: Index Migration and Dual-Read Fallbacks
When replacing legacy data structures:
- The replacement must maintain read fallbacks for legacy keys (e.g., `get_project_ids` reading `DataKey::ProjectIds` if `ProjectIdsBucketCount` is unset).
- Writes should write only to the new structure (`DataKey::ProjectIdsBucket`).
- Batch migration scripts should incrementally copy legacy data into new structures to stay within per-transaction CPU and memory budgets.

### Rule 5: State Deletion vs Tombstoning
- When removing an entity (e.g., removing a token via `disallow_token`), use `env.storage().persistent().remove(&DataKey::AllowedToken(address))` and remove the item from `AllowedTokenList`.
- Ensure related counters (`AllowedTokenCount`) are decremented consistently to prevent index drift.

---

## 5. Storage Migration Checklist & Test Expectations

Before deploying any contract upgrade that touches storage layout:

### Pre-Migration Checklist
- [ ] **ADR Decision Record Completed:** File an ADR under `docs/adr/` documenting the layout change, risk assessment, and rollback path.
- [ ] **Storage Key Audit:** Verify all new keys are additive and do not collide with existing `DataKey` variants.
- [ ] **Fallback Verification:** Verify contract logic falls back to safe default constants when keys are uninitialized.
- [ ] **Interface & Types Synchronization:**
  ```bash
  npm run generate:contract-interface
  npm run generate:contract-types
  ```
- [ ] **Interface Drift Check:**
  ```bash
  node scripts/check-contract-interface-drift.mjs
  ```

### Test Expectations
Every storage layout change must include test coverage across the following test suites:

1. **Unit & Legacy Fallback Tests (`contracts/tests.rs`):**
   - Test behavior when storage keys are uninitialized (cold state).
   - Test legacy fallback paths (e.g. testing `ProjectIds` flat index fallback when `ProjectIdsBucket` is not yet populated).
2. **TTL Renewal Tests (`contracts/ttl_renewal_tests.rs`):**
   - Verify every new/modified storage key is properly bumped by `PROJECT_TTL_BUMP_LEDGERS`.
   - Verify TTL is extended on read and write paths.
3. **Cost Benchmark Tests (`contracts/cost_benchmark_tests.rs`):**
   - Verify CPU instructions and RAM usage remain within Soroban limits when iterating or storing updated schemas.
4. **End-to-End Migration Simulation:**
   - Execute test against state populated with previous contract WASM, perform upgrade via `stellar contract install` / upgrade call, and assert read/write operations succeed without data corruption.

---

## 6. References & Related Runbooks

- [Contract Interface Release Checklist](./CONTRACT_INTERFACE_RELEASE_CHECKLIST.md)
- [Contract Release and Upgrade Runbook](./contract-release-and-upgrade-runbook.md)
- [Contract Cost Benchmarks](./contract-cost-benchmarks.md)
- [Contract Upgrade Decision Record (ADR 0001)](./adr/0001-contract-upgrade-decision-record.md)
- [Stellar Soroban State Archival & TTL Documentation](https://developers.stellar.org/docs/learn/fundamentals/state-archival)
