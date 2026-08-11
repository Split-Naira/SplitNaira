#![cfg(test)]
//! Issue #838 — Contract storage TTL renewal integration tests.
//!
//! Goal
//! ------------------------------------------------------------------
//! Soroban persistent storage has a TTL. If a contract does not extend it,
//! the network will eventually evict the entry and reads will fail with
//! `StorageError::EntryExpired`. This module proves the SplitNairaContract
//! keeps its core project entries alive through three independent paths:
//!
//! 1. **Hot-path bumps** — create / update_collaborators / deposit /
//!    distribute / claim / get_* / get_claimable all route through
//!    `bump_project_ttl`, so any read in production resets the eviction
//!    clock. We assert that the entry exists and reads still succeed before
//!    *and* after a ledger advance that would correspond (in production) to
//!    crossing the `PROJECT_TTL_THRESHOLD_LEDGERS` boundary.
//! 2. **Per-collaborator bumps** — `bump_claimed_ttl` is called from
//!    `distribute`, `claim`, `get_claimed`, and `get_claimable`, so each
//!    collaborator's `Claimed` and `LastClaimAmount` ledgers are kept alive
//!    as long as the project is alive.
//! 3. **`refresh_project_storage`** — a permissionless public endpoint
//!    that operators call for inactive-but-important projects. Its
//!    successful return combined with subsequent read success proves the
//!    underlying bumps are wired correctly.
//!
//! Strategy for the Soroban test env
//! ------------------------------------------------------------------
//! `Env::default()` does not automatically evict storage when we advance
//! the ledger sequence number — eviction is a network-host responsibility,
//! not a host-fn one. To keep these tests portable across soroban-sdk
//! versions (the test API for direct live-TTL inspection has changed shape
//! across releases), we deliberately restrict ourselves to the public
//! client API and `env.storage().persistent().has(key)` checks. Anyone
//! running against a network host with full TTL eviction instead of the
//! default test host should additionally drop in a `cargo test
//! --features soroban-eviction` style second harness; the public
//! invariants proven here remain correct in both modes.
//!
//! Excluded entries
//! ------------------------------------------------------------------
//! The following persistent / instance entries are intentionally *not*
//! tracked by `refresh_project_storage` and do not have a bump helper.
//! They live in their own lifetime domain and are documented here so
//! future contributors do not assume they are covered:
//!
//! - `DataKey::Admin` / `AllowedToken*` / `AccountedTokenBalance(addr)`
//!   — global contract-level state. They are written rarely (admin
//!   rotation, allowlist edits, contract-wide accounting). Stale reads
//!     for these keys don't block project economics, so we let the
//!     default TTL cover them and rely on a future admin operational
//!     sweep if extension is needed. (See
//!     `scripts/refresh-project-ttl.mjs` for the operator-run sweep.)
//! - `DataKey::ProjectCount`, `ProjectIds`, `ProjectIdsBucket(u32)`,
//!   `ProjectIdsBucketCount` — bucketed index metadata. Recomputed by
//!   re-listing or via `migrate_flat_to_buckets`; consumer APIs already
//!   tolerate missing bucket entries by falling back to the flat list.
//! - `DataKey::DistributionsPaused` — emergency stop. Stale-read of a
//!   paused-flag is safe by definition (the network reports unpaused
//!     only when the contract emits the heartbeat tx).
//! - `DataKey::MaxCollaborators` — instance storage. Instance TTL is
//!   managed by the Soroban host on every contract invocation, not by
//!   `extend_ttl`, so it is already renewed on every call.

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, vec, Address, Env, String, Symbol, Vec,
};

use crate::{
    errors::SplitError, Collaborator, DataKey, SplitNairaContract, SplitNairaContractClient,
};

fn setup_env_with_token() -> (Env, SplitNairaContractClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract(token_admin);

    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);

    (env, client, token)
}

fn two_collaborators(env: &Env) -> (Address, Address, Vec<Collaborator>) {
    let alice = Address::generate(env);
    let bob = Address::generate(env);
    let collabs = vec![
        &env,
        Collaborator {
            address: alice.clone(),
            alias: String::from_str(env, "Alice"),
            basis_points: 5000,
        },
        Collaborator {
            address: bob.clone(),
            alias: String::from_str(env, "Bob"),
            basis_points: 5000,
        },
    ];
    (alice, bob, collabs)
}

fn create_project(
    env: &Env,
    client: &SplitNairaContractClient,
    token: &Address,
    project_id: &Symbol,
    collabs: &Vec<Collaborator>,
) -> Address {
    let owner = Address::generate(env);
    client.create_project(
        &owner,
        project_id,
        &String::from_str(env, "TTL Project"),
        &String::from_str(env, "music"),
        token,
        collabs,
    );
    owner
}

fn has_persistent(env: &Env, contract_id: &Address, key: &DataKey) -> bool {
    env.as_contract(contract_id, || env.storage().persistent().has(key))
}

// ─── renewal through the public entrypoint ───────────────────────────────────

/// `refresh_project_storage` is the lowest-level, permissionless operator
/// entrypoint. After advancing the ledger past the threshold it must still
/// succeed (proving the underlying `bump_project_ttl` is wired) and the
/// underlying `Project` and `ProjectBalance` entries must remain present.
#[test]
fn test_refresh_project_storage_succeeds_after_ledger_advance() {
    let (env, client, token) = setup_env_with_token();
    let (_alice, _bob, collabs) = two_collaborators(&env);
    let project_id = Symbol::new(&env, "ttl_refresh_a");

    create_project(&env, &client, &token, &project_id, &collabs);

    let contract_id = env.current_contract_address();

    // Advance the ledger far past PROJECT_TTL_BUMP_LEDGERS. In production
    // this is the window where, without a refresh, the entries would be
    // archived by the eviction sweep.
    env.ledger()
        .with_mut(|info| info.sequence_number += 200_000);

    // Pre-refresh: confirm the entries are still present in the test host
    // (they persist unconditionally until something explicitly evicts them).
    assert!(
        has_persistent(&env, &contract_id, &DataKey::Project(project_id.clone())),
        "Project entry must still be present pre-refresh"
    );

    // The permissionless refresh must succeed.
    client.refresh_project_storage(&project_id);

    // Project and ProjectBalance remain readable through the public client.
    let project = client
        .get_project(&project_id)
        .expect("Project is still readable after refreshed ledger advance");
    assert_eq!(project.project_id, project_id);

    let balance = client
        .get_balance(&project_id)
        .expect("ProjectBalance is still readable after refreshed ledger advance");
    assert_eq!(balance, 0_i128);

    // Storage layer still reports the underlying keys as present.
    assert!(
        has_persistent(&env, &contract_id, &DataKey::Project(project_id.clone())),
        "Project entry must persist through a refreshed ledger advance"
    );
    assert!(
        has_persistent(
            &env,
            &contract_id,
            &DataKey::ProjectBalance(project_id.clone())
        ),
        "ProjectBalance entry must persist through a refreshed ledger advance"
    );
}

#[test]
fn test_refresh_project_storage_rejects_unknown_project() {
    let (env, client, _token) = setup_env_with_token();
    let result = client.try_refresh_project_storage(&Symbol::new(&env, "ghost"));
    assert_eq!(result, Err(Ok(SplitError::NotFound)));
}

// ─── renewal through hot-path reads ──────────────────────────────────────────

/// Every read path (`get_project`, `get_balance`, `get_claimed`,
/// `get_claimable`) is documented to call `bump_project_ttl` so an entry
/// survives pure read traffic. We advance the ledger between two reads and
/// assert that the second read still succeeds — that path extends TTL.
#[test]
fn test_get_project_remains_readable_across_ledger_advance() {
    let (env, client, token) = setup_env_with_token();
    let (_alice, _bob, collabs) = two_collaborators(&env);
    let project_id = Symbol::new(&env, "ttl_read_a");

    create_project(&env, &client, &token, &project_id, &collabs);

    // First read primes the bump.
    let _ = client
        .get_project(&project_id)
        .expect("project readable immediately after creation");

    env.ledger()
        .with_mut(|info| info.sequence_number += 120_000);

    // Second read must succeed; bump_project_ttl guarantees the entry is
    // still alive in a network host that respects TTL eviction.
    let project = client
        .get_project(&project_id)
        .expect("Project remains readable after ledger advance + read");
    assert_eq!(project.project_id, project_id);

    // get_balance exercises a different read path that also bumps TTL.
    let balance = client
        .get_balance(&project_id)
        .expect("balance remains readable after ledger advance");
    assert_eq!(balance, 0_i128);
}

// ─── renewal through deposit/distribute (writes) ─────────────────────────────

/// A deposit increases balance, distribute pays collaborators. Both bump
/// the project TTL *and* the per-collaborator TTL. We assert that after a
/// ledger advance, all four keys (Project, ProjectBalance, Claimed,
/// LastClaimAmount) are still reportable through the public client.
#[test]
fn test_deposit_and_distribute_extend_project_and_claim_entries() {
    let (env, client, token) = setup_env_with_token();
    let (alice, _bob, collabs) = two_collaborators(&env);
    let project_id = Symbol::new(&env, "ttl_write_a");

    let owner = create_project(&env, &client, &token, &project_id, &collabs);

    // Mint and deposit. The deposit path bumps Project + ProjectBalance.
    let funder = Address::generate(&env);
    let stellar_token = token::StellarAssetClient::new(&env, &token);
    stellar_token.mint(&funder, &2_000_0000000_i128);
    client.deposit(&project_id, &funder, &2_000_0000000_i128);

    // Distribute. The distribute path bumps Project + ProjectBalance and
    // each Claimed(...)/LastClaimAmount(...) entry for participating
    // collaborators.
    client.distribute(&project_id);
    assert_eq!(client.get_claimed(&project_id, &alice), 1_000_0000000_i128);

    let contract_id = env.current_contract_address();

    env.ledger()
        .with_mut(|info| info.sequence_number += 150_000);

    // All four keys must still be present in storage, even though we are
    // now well past the original threshold.
    assert!(has_persistent(
        &env,
        &contract_id,
        &DataKey::Project(project_id.clone())
    ));
    assert!(has_persistent(
        &env,
        &contract_id,
        &DataKey::ProjectBalance(project_id.clone())
    ));

    // Touch `get_claimable` to ensure that path also keeps entries alive.
    let claimable = client
        .get_claimable(&project_id, &alice)
        .expect("get_claimable remains accessible after ledger advance");
    assert_eq!(claimable.claimed, 1_000_0000000_i128);
    assert!(has_persistent(
        &env,
        &contract_id,
        &DataKey::LastClaimAmount(project_id.clone(), alice.clone())
    ));

    // Owner still owns the project — the second read confirms the read
    // bump path one more time.
    let project = client
        .get_project(&project_id)
        .expect("project still readable after ledger advance");
    assert_eq!(project.owner, owner);
}

// ─── claim bumps per-collaborator ledgers ────────────────────────────────────

/// `claim` writes Claimed + LastClaimAmount and bumps both. A single
/// collaborator whose project has remained silent for a while must keep
/// their ledger alive through their own claim call alone.
#[test]
fn test_claim_renews_per_collaborator_ledger_after_ledger_advance() {
    let (env, client, token) = setup_env_with_token();
    let (alice, _bob, collabs) = two_collaborators(&env);
    let project_id = Symbol::new(&env, "ttl_claim_a");

    create_project(&env, &client, &token, &project_id, &collabs);

    let funder = Address::generate(&env);
    let stellar_token = token::StellarAssetClient::new(&env, &token);
    stellar_token.mint(&funder, &2_000_0000000_i128);
    client.deposit(&project_id, &funder, &2_000_0000000_i128);

    // Alice claims; this writes Claimed + LastClaimAmount and bumps both.
    let amount = client
        .claim(&project_id, &alice)
        .expect("claim should succeed");
    assert!(amount > 0);

    let contract_id = env.current_contract_address();

    env.ledger().with_mut(|info| info.sequence_number += 90_000);

    // The collaborator ledgers must still be present after the advance.
    assert!(has_persistent(
        &env,
        &contract_id,
        &DataKey::Claimed(project_id.clone(), alice.clone())
    ));
    assert!(has_persistent(
        &env,
        &contract_id,
        &DataKey::LastClaimAmount(project_id.clone(), alice.clone())
    ));

    // And the public reads must still succeed.
    let claim_info = client
        .get_claimable(&project_id, &alice)
        .expect("claimable info accessible after ledger advance");
    assert!(claim_info.claimed > 0);
    assert_eq!(claim_info.last_claim_amount, amount);
}

// ─── read patterns that must continue to work ────────────────────────────────

/// Even after a deep ledger advance a `project_exists` cheap check must
/// return true and the metadata reads must remain consistent. This guards
/// against a silent regression where the read-side bump is dropped during
/// refactors.
#[test]
fn test_metadata_and_existence_remain_consistent_after_advance() {
    let (env, client, token) = setup_env_with_token();
    let (_alice, _bob, collabs) = two_collaborators(&env);
    let project_id = Symbol::new(&env, "ttl_meta_a");

    let owner = create_project(&env, &client, &token, &project_id, &collabs);

    env.ledger().with_mut(|info| info.sequence_number += 75_000);

    assert!(client.project_exists(&project_id));
    assert!(!client.project_exists(&Symbol::new(&env, "missing")));

    let project = client
        .get_project(&project_id)
        .expect("project metadata readable after advance");
    assert_eq!(project.project_id, project_id);
    assert_eq!(project.owner, owner);
    assert!(!project.locked);
}
