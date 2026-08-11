#![cfg(test)]
//! Authorization boundary tests (issue #865).
//!
//! Table-style coverage of unauthorized-caller attempts across the contract's
//! sensitive (state-mutating) entry points: project owner-gated operations,
//! admin-gated operations, and the collaborator-gated `claim` payout. Each
//! case asserts both the returned error code and that no contract state was
//! mutated by the rejected call.
//!
//! Notes on scope, matching the authorization assumptions documented in
//! `contracts/README.md`:
//! - `distribute` / `batch_distribute` (the payout trigger) are intentionally
//!   permissionless — anyone may call them, since the payout math itself is
//!   trustless and funds only ever move to the recorded collaborators. This
//!   file documents that with a passing-call test rather than an
//!   unauthorized-caller test, since there is no caller to reject.
//! - The contract has no reversible "unlock"; `lock_project` is a one-way
//!   permanent lock. The closest lock/unlock-shaped admin pair is
//!   `pause_distributions` / `unpause_distributions`, covered below.

use crate::{errors::SplitError, Collaborator, SplitNairaContract, SplitNairaContractClient};
use soroban_sdk::{testutils::Address as _, token, vec, Address, Env, String, Symbol, Vec};

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Registers the contract and returns a ready-to-use client + contract address.
fn make_client(env: &Env) -> (SplitNairaContractClient, Address) {
    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(env, &contract_id);
    (client, contract_id)
}

/// Returns a Vec of two collaborators splitting 50/50.
fn two_collabs(env: &Env) -> Vec<Collaborator> {
    let a = Address::generate(env);
    let b = Address::generate(env);
    vec![
        env,
        Collaborator {
            address: a,
            alias: String::from_str(env, "A"),
            basis_points: 5000,
        },
        Collaborator {
            address: b,
            alias: String::from_str(env, "B"),
            basis_points: 5000,
        },
    ]
}

/// Creates a project with a registered token and returns (client, owner, token).
fn setup_project<'a>(
    env: &'a Env,
    project_id: &'a Symbol,
) -> (SplitNairaContractClient<'a>, Address, Address) {
    let (client, _) = make_client(env);
    let token_admin = Address::generate(env);
    let token = env.register_stellar_asset_contract(token_admin);
    let owner = Address::generate(env);
    let collabs = two_collabs(env);

    client.create_project(
        &owner,
        project_id,
        &String::from_str(env, "Test Project"),
        &String::from_str(env, "music"),
        &token,
        &collabs,
    );
    (client, owner, token)
}

/// Mints `amount` of `token` to `from` and deposits it into `project_id`.
fn deposit_to_project(
    env: &Env,
    client: &SplitNairaContractClient,
    token: &Address,
    project_id: &Symbol,
    from: &Address,
    amount: i128,
) {
    let token_client = token::StellarAssetClient::new(env, token);
    token_client.mint(from, &amount);
    client.deposit(project_id, from, &amount);
}

/// Asserts that every observable field of `before` and `after` is identical,
/// i.e. a rejected call caused no state mutation. `SplitProject`/`Collaborator`
/// don't derive `PartialEq`, so fields are compared individually.
fn assert_project_unchanged(before: &SplitProject, after: &SplitProject) {
    assert_eq!(before.owner, after.owner);
    assert_eq!(before.title, after.title);
    assert_eq!(before.project_type, after.project_type);
    assert_eq!(before.token, after.token);
    assert_eq!(before.locked, after.locked);
    assert_eq!(before.total_distributed, after.total_distributed);
    assert_eq!(before.distribution_round, after.distribution_round);
    assert_eq!(before.collaborators.len(), after.collaborators.len());
    for i in 0..before.collaborators.len() {
        let b = before.collaborators.get(i).unwrap();
        let a = after.collaborators.get(i).unwrap();
        assert_eq!(b.address, a.address);
        assert_eq!(b.basis_points, a.basis_points);
    }
}

use crate::SplitProject;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Owner-gated operations vs. a non-owner caller (existing project)
// ─────────────────────────────────────────────────────────────────────────────

/// Table of owner-gated mutations: a non-owner attacker must be rejected with
/// `Unauthorized` and the project must be left exactly as it was.
#[test]
fn test_owner_gated_operations_reject_non_owner_and_preserve_state() {
    // update_collaborators
    {
        let env = Env::default();
        env.mock_all_auths();
        let project_id = Symbol::new(&env, "auth_uc");
        let (client, _owner, _token) = setup_project(&env, &project_id);
        let attacker = Address::generate(&env);
        let before = client.get_project(&project_id).unwrap();

        let result = client.try_update_collaborators(&project_id, &attacker, &two_collabs(&env));
        assert_eq!(result, Err(Ok(SplitError::Unauthorized)));

        let after = client.get_project(&project_id).unwrap();
        assert_project_unchanged(&before, &after);
    }

    // lock_project
    {
        let env = Env::default();
        env.mock_all_auths();
        let project_id = Symbol::new(&env, "auth_lock");
        let (client, _owner, _token) = setup_project(&env, &project_id);
        let attacker = Address::generate(&env);
        let before = client.get_project(&project_id).unwrap();

        let result = client.try_lock_project(&project_id, &attacker);
        assert_eq!(result, Err(Ok(SplitError::Unauthorized)));

        let after = client.get_project(&project_id).unwrap();
        assert_project_unchanged(&before, &after);
        assert!(!after.locked);
    }

    // update_project_metadata
    {
        let env = Env::default();
        env.mock_all_auths();
        let project_id = Symbol::new(&env, "auth_meta");
        let (client, _owner, _token) = setup_project(&env, &project_id);
        let attacker = Address::generate(&env);
        let before = client.get_project(&project_id).unwrap();

        let result = client.try_update_project_metadata(
            &project_id,
            &attacker,
            &String::from_str(&env, "Hijacked Title"),
            &String::from_str(&env, "film"),
        );
        assert_eq!(result, Err(Ok(SplitError::Unauthorized)));

        let after = client.get_project(&project_id).unwrap();
        assert_project_unchanged(&before, &after);
    }

    // transfer_project_ownership
    {
        let env = Env::default();
        env.mock_all_auths();
        let project_id = Symbol::new(&env, "auth_xfer");
        let (client, _owner, _token) = setup_project(&env, &project_id);
        let attacker = Address::generate(&env);
        let attacker_target = Address::generate(&env);
        let before = client.get_project(&project_id).unwrap();

        let result =
            client.try_transfer_project_ownership(&project_id, &attacker, &attacker_target);
        assert_eq!(result, Err(Ok(SplitError::Unauthorized)));

        let after = client.get_project(&project_id).unwrap();
        assert_project_unchanged(&before, &after);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Owner-gated operations vs. a nonexistent project ID
// ─────────────────────────────────────────────────────────────────────────────

/// The existence guard runs before the ownership check on every owner-gated
/// method, so a nonexistent project always returns `NotFound` first — even
/// when the caller also happens not to be (and could never be) the owner.
#[test]
fn test_owner_gated_operations_on_nonexistent_project_return_not_found() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = make_client(&env);
    let ghost = Symbol::new(&env, "ghost_auth");
    let caller = Address::generate(&env);
    let other = Address::generate(&env);

    assert_eq!(
        client.try_update_collaborators(&ghost, &caller, &two_collabs(&env)),
        Err(Ok(SplitError::NotFound))
    );
    assert_eq!(
        client.try_lock_project(&ghost, &caller),
        Err(Ok(SplitError::NotFound))
    );
    assert_eq!(
        client.try_update_project_metadata(
            &ghost,
            &caller,
            &String::from_str(&env, "Title"),
            &String::from_str(&env, "music"),
        ),
        Err(Ok(SplitError::NotFound))
    );
    assert_eq!(
        client.try_transfer_project_ownership(&ghost, &caller, &other),
        Err(Ok(SplitError::NotFound))
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Admin-gated operations vs. a non-admin caller
// ─────────────────────────────────────────────────────────────────────────────

/// Table of admin-gated mutations: both the "no admin configured yet" and the
/// "wrong caller once an admin is configured" cases must be rejected with the
/// documented error, and any prior admin-controlled state must be preserved.
#[test]
fn test_admin_gated_operations_reject_non_admin_and_preserve_state() {
    // pause_distributions: configured admin rejects a different caller.
    {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _) = make_client(&env);
        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);
        client.set_admin(&admin);

        let result = client.try_pause_distributions(&attacker);
        assert_eq!(result, Err(Ok(SplitError::Unauthorized)));
        assert!(!client.is_distributions_paused());
    }

    // unpause_distributions: no admin configured yet.
    {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _) = make_client(&env);
        let stranger = Address::generate(&env);

        let result = client.try_unpause_distributions(&stranger);
        assert_eq!(result, Err(Ok(SplitError::AdminNotSet)));
    }

    // unpause_distributions: configured admin rejects a different caller,
    // and the paused flag must remain untouched by the rejected call.
    {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _) = make_client(&env);
        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);
        client.set_admin(&admin);
        client.pause_distributions(&admin);

        let result = client.try_unpause_distributions(&attacker);
        assert_eq!(result, Err(Ok(SplitError::Unauthorized)));
        assert!(client.is_distributions_paused());
    }

    // disallow_token: no admin configured yet.
    {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _) = make_client(&env);
        let token_admin = Address::generate(&env);
        let token = env.register_stellar_asset_contract(token_admin);
        let stranger = Address::generate(&env);

        let result = client.try_disallow_token(&stranger, &token);
        assert_eq!(result, Err(Ok(SplitError::AdminNotSet)));
    }

    // disallow_token: configured admin rejects a different caller, and the
    // allowlist entry must remain untouched by the rejected call.
    {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _) = make_client(&env);
        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token = env.register_stellar_asset_contract(token_admin);
        client.set_admin(&admin);
        client.allow_token(&admin, &token);

        let result = client.try_disallow_token(&attacker, &token);
        assert_eq!(result, Err(Ok(SplitError::Unauthorized)));
        assert!(client.is_token_allowed(&token));
    }

    // migrate_flat_to_buckets: no admin configured yet.
    {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _) = make_client(&env);
        let stranger = Address::generate(&env);

        let result = client.try_migrate_flat_to_buckets(&stranger);
        assert_eq!(result, Err(Ok(SplitError::AdminNotSet)));
    }

    // migrate_flat_to_buckets: configured admin rejects a different caller.
    {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _) = make_client(&env);
        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);
        client.set_admin(&admin);

        let result = client.try_migrate_flat_to_buckets(&attacker);
        assert_eq!(result, Err(Ok(SplitError::Unauthorized)));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Payout (`claim`) vs. a non-collaborator caller
// ─────────────────────────────────────────────────────────────────────────────

/// A caller who is not a registered collaborator on the project cannot claim
/// a payout, and the rejected attempt must not move funds or mutate ledgers.
#[test]
fn test_claim_rejects_non_collaborator_and_preserves_balances() {
    let env = Env::default();
    env.mock_all_auths();
    let project_id = Symbol::new(&env, "auth_claim");
    let (client, owner, token) = setup_project(&env, &project_id);
    let outsider = Address::generate(&env);

    deposit_to_project(
        &env,
        &client,
        &token,
        &project_id,
        &owner,
        1_000_0000000i128,
    );

    let before_balance = client.get_balance(&project_id);
    let before_claimed = client.get_claimed(&project_id, &outsider);

    let result = client.try_claim(&project_id, &outsider);
    assert_eq!(result, Err(Ok(SplitError::NotACollaborator)));

    assert_eq!(client.get_balance(&project_id), before_balance);
    assert_eq!(client.get_claimed(&project_id, &outsider), before_claimed);
}

/// Claiming against a nonexistent project returns `NotFound`, not
/// `NotACollaborator` — the existence guard runs first.
#[test]
fn test_claim_on_nonexistent_project_returns_not_found() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = make_client(&env);
    let outsider = Address::generate(&env);

    let result = client.try_claim(&Symbol::new(&env, "ghost_claim"), &outsider);
    assert_eq!(result, Err(Ok(SplitError::NotFound)));
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. `distribute` is intentionally permissionless — documents the assumption
// ─────────────────────────────────────────────────────────────────────────────

/// `distribute` has no `require_auth` gate by design: the payout math is
/// trustless and funds only ever move to the recorded collaborators. Proof:
/// the call still succeeds even with zero authorization entries supplied
/// (`env.set_auths(&[])`), which would make any `require_auth`-gated method
/// fail. See the "Authorization Assumptions" section in `contracts/README.md`.
#[test]
fn test_distribute_is_permissionless_by_design() {
    let env = Env::default();
    env.mock_all_auths();
    let project_id = Symbol::new(&env, "auth_dist");
    let (client, owner, token) = setup_project(&env, &project_id);

    deposit_to_project(
        &env,
        &client,
        &token,
        &project_id,
        &owner,
        1_000_0000000i128,
    );

    // Zero authorization entries: no address, including the owner, has
    // signed this invocation. A `require_auth`-gated call would panic here.
    env.set_auths(&[]);
    let result = client.try_distribute(&project_id);
    assert!(result.is_ok());
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Admin key rotation authorization (issue #941)
// ─────────────────────────────────────────────────────────────────────────────

/// An unauthorized caller cannot rotate the contract admin.
///
/// `set_admin` requires the *currently stored* admin to authorize the call.
/// Clearing all auth entries before the call removes that authorization so the
/// host-level auth check fires, and the stored admin address must remain the
/// original one (verified by confirming the original admin can still perform
/// admin-gated operations while the attacker cannot).
#[test]
fn test_set_admin_rejects_unauthorized_rotation_and_preserves_state() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = make_client(&env);

    let original_admin = Address::generate(&env);
    let attacker = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract(token_admin);

    // Install the initial admin.
    client.set_admin(&original_admin);

    // Drain all authorization entries — the stored admin has not signed.
    // `set_admin` calls `current_admin.require_auth()`, so without that
    // signature the host rejects the invocation.
    env.set_auths(&[]);
    let result = client.try_set_admin(&attacker);
    assert!(result.is_err(), "unauthorized rotation must be rejected");

    // Restore full auth mocking to probe the post-attempt state.
    env.mock_all_auths();

    // The original admin must still control the contract.
    let allow_result = client.try_allow_token(&original_admin, &token);
    assert!(
        allow_result.is_ok(),
        "original admin must retain control after a failed rotation attempt"
    );
    assert!(client.is_token_allowed(&token));

    // The attacker must not have gained admin rights.
    let attacker_result = client.try_allow_token(&attacker, &token);
    assert_eq!(
        attacker_result,
        Err(Ok(SplitError::Unauthorized)),
        "attacker must not acquire admin privileges"
    );
}

/// The current admin can successfully rotate the contract admin to a new address.
///
/// After rotation the new admin must be able to perform admin-gated operations
/// and the previous admin must lose those privileges.
#[test]
fn test_set_admin_successful_rotation_transfers_control() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = make_client(&env);

    let original_admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract(token_admin);

    // Bootstrap with an initial admin then rotate.
    client.set_admin(&original_admin);
    let rotation_result = client.try_set_admin(&new_admin);
    assert!(
        rotation_result.is_ok(),
        "admin rotation by current admin must succeed"
    );

    // New admin can now perform admin-gated operations.
    let allow_result = client.try_allow_token(&new_admin, &token);
    assert!(
        allow_result.is_ok(),
        "new admin must be able to allow tokens"
    );
    assert!(client.is_token_allowed(&token));

    // Former admin no longer has privileges.
    let old_admin_result = client.try_allow_token(&original_admin, &token);
    assert_eq!(
        old_admin_result,
        Err(Ok(SplitError::Unauthorized)),
        "former admin must lose privileges after rotation"
    );
}
