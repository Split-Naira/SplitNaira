#![cfg(test)]

//! Authorization boundary tests for SplitNaira (issue #865).
//!
//! These tests verify that sensitive state-mutating entry points enforce their
//! documented authorization boundaries and that rejected calls do not mutate
//! contract state.
//!
//! ## Authorization model
//!
//! - Project owners control owner-gated project operations.
//! - The configured administrator controls admin-gated operations.
//! - Registered collaborators may claim their project payouts.
//! - `distribute` and `batch_distribute` are intentionally permissionless.
//!   Anyone may trigger distribution because funds are distributed according
//!   to the project's recorded collaborator shares.
//! - `lock_project` is permanent; there is no corresponding unlock operation.
//! - `pause_distributions` / `unpause_distributions` provide the reversible
//!   administrator-controlled state transition.
//!
//! These tests focus on authorization boundaries. Business-rule validation
//! belongs in the reliability and functional test suites.

use crate::{
    errors::SplitError,
    Collaborator,
    SplitNairaContract,
    SplitNairaContractClient,
    SplitProject,
};
use soroban_sdk::{
    testutils::Address as _,
    token,
    vec,
    Address,
    Env,
    String,
    Symbol,
    Vec,
};

// -----------------------------------------------------------------------------
// Shared helpers
// -----------------------------------------------------------------------------

/// Registers a SplitNaira contract and returns a ready-to-use client.
fn make_client(env: &Env) -> SplitNairaContractClient {
    let contract_id = env.register_contract(None, SplitNairaContract);
    SplitNairaContractClient::new(env, &contract_id)
}

/// Returns two collaborators with an even 50/50 split.
fn two_collabs(env: &Env) -> Vec<Collaborator> {
    let alice = Address::generate(env);
    let bob = Address::generate(env);

    vec![
        env,
        Collaborator {
            address: alice,
            alias: String::from_str(env, "Alice"),
            basis_points: 5000,
        },
        Collaborator {
            address: bob,
            alias: String::from_str(env, "Bob"),
            basis_points: 5000,
        },
    ]
}

/// Creates a project with a registered Stellar asset token.
///
/// Returns `(client, owner, token)`.
fn setup_project<'a>(
    env: &'a Env,
    project_id: &'a Symbol,
) -> (SplitNairaContractClient<'a>, Address, Address) {
    let client = make_client(env);

    let token_admin = Address::generate(env);
    let token = env.register_stellar_asset_contract(token_admin);

    let owner = Address::generate(env);
    let collaborators = two_collabs(env);

    client.create_project(
        &owner,
        project_id,
        &String::from_str(env, "Test Project"),
        &String::from_str(env, "music"),
        &token,
        &collaborators,
    );

    (client, owner, token)
}

/// Mints tokens to `from` and deposits them into the project.
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

/// Verifies that a rejected operation did not modify any observable project
/// state.
///
/// `SplitProject` and `Collaborator` do not implement `PartialEq`, so fields
/// are compared explicitly.
fn assert_project_unchanged(before: &SplitProject, after: &SplitProject) {
    assert_eq!(before.owner, after.owner);
    assert_eq!(before.title, after.title);
    assert_eq!(before.project_type, after.project_type);
    assert_eq!(before.token, after.token);
    assert_eq!(before.locked, after.locked);
    assert_eq!(before.total_distributed, after.total_distributed);
    assert_eq!(before.distribution_round, after.distribution_round);

    assert_eq!(before.collaborators.len(), after.collaborators.len());

    for index in 0..before.collaborators.len() {
        let before_collaborator = before.collaborators.get(index).unwrap();
        let after_collaborator = after.collaborators.get(index).unwrap();

        assert_eq!(
            before_collaborator.address,
            after_collaborator.address
        );
        assert_eq!(
            before_collaborator.basis_points,
            after_collaborator.basis_points
        );
        assert_eq!(
            before_collaborator.alias,
            after_collaborator.alias
        );
    }
}

// -----------------------------------------------------------------------------
// 1. Owner-gated operations
// -----------------------------------------------------------------------------

/// A caller who is not the project owner must not be able to modify
/// owner-controlled project state.
///
/// Every rejected operation must return `Unauthorized` and leave the project
/// unchanged.
#[test]
fn test_owner_gated_operations_reject_non_owner() {
    let env = Env::default();
    env.mock_all_auths();

    // update_collaborators
    {
        let project_id = Symbol::new(&env, "auth_update");
        let (client, _owner, _token) = setup_project(&env, &project_id);
        let attacker = Address::generate(&env);

        let before = client.get_project(&project_id).unwrap();

        let result =
            client.try_update_collaborators(&project_id, &attacker, &two_collabs(&env));

        assert_eq!(result, Err(Ok(SplitError::Unauthorized)));

        let after = client.get_project(&project_id).unwrap();
        assert_project_unchanged(&before, &after);
    }

    // lock_project
    {
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
        let project_id = Symbol::new(&env, "auth_metadata");
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
        let project_id = Symbol::new(&env, "auth_transfer");
        let (client, _owner, _token) = setup_project(&env, &project_id);
        let attacker = Address::generate(&env);
        let attacker_target = Address::generate(&env);

        let before = client.get_project(&project_id).unwrap();

        let result =
            client.try_transfer_project_ownership(
                &project_id,
                &attacker,
                &attacker_target,
            );

        assert_eq!(result, Err(Ok(SplitError::Unauthorized)));

        let after = client.get_project(&project_id).unwrap();
        assert_project_unchanged(&before, &after);
    }
}

// -----------------------------------------------------------------------------
// 2. Owner-gated operations against nonexistent projects
// -----------------------------------------------------------------------------

/// A nonexistent project must fail the existence check before authorization.
///
/// This verifies that owner-gated operations consistently return `NotFound`
/// when the requested project does not exist.
#[test]
fn test_owner_gated_operations_on_nonexistent_project_return_not_found() {
    let env = Env::default();
    env.mock_all_auths();

    let client = make_client(&env);
    let project_id = Symbol::new(&env, "missing_project");
    let caller = Address::generate(&env);
    let new_owner = Address::generate(&env);

    assert_eq!(
        client.try_update_collaborators(
            &project_id,
            &caller,
            &two_collabs(&env),
        ),
        Err(Ok(SplitError::NotFound))
    );

    assert_eq!(
        client.try_lock_project(&project_id, &caller),
        Err(Ok(SplitError::NotFound))
    );

    assert_eq!(
        client.try_update_project_metadata(
            &project_id,
            &caller,
            &String::from_str(&env, "Title"),
            &String::from_str(&env, "music"),
        ),
        Err(Ok(SplitError::NotFound))
    );

    assert_eq!(
        client.try_transfer_project_ownership(
            &project_id,
            &caller,
            &new_owner,
        ),
        Err(Ok(SplitError::NotFound))
    );
}

// -----------------------------------------------------------------------------
// 3. Administrator-gated operations
// -----------------------------------------------------------------------------

/// Unauthorized callers must not be able to modify administrator-controlled
/// contract state.
///
/// This covers both:
/// - operations attempted before an administrator is configured; and
/// - operations attempted by a caller other than the configured administrator.
#[test]
fn test_admin_gated_operations_reject_unauthorized_callers() {
    // pause_distributions: configured admin rejects attacker.
    {
        let env = Env::default();
        env.mock_all_auths();

        let client = make_client(&env);
        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);

        client.set_admin(&admin);

        let result = client.try_pause_distributions(&attacker);

        assert_eq!(result, Err(Ok(SplitError::Unauthorized)));
        assert!(!client.is_distributions_paused());
    }

    // unpause_distributions: no admin configured.
    {
        let env = Env::default();
        env.mock_all_auths();

        let client = make_client(&env);
        let caller = Address::generate(&env);

        let result = client.try_unpause_distributions(&caller);

        assert_eq!(result, Err(Ok(SplitError::AdminNotSet)));
    }

    // unpause_distributions: configured admin rejects attacker.
    {
        let env = Env::default();
        env.mock_all_auths();

        let client = make_client(&env);
        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);

        client.set_admin(&admin);
        client.pause_distributions(&admin);

        let result = client.try_unpause_distributions(&attacker);

        assert_eq!(result, Err(Ok(SplitError::Unauthorized)));
        assert!(client.is_distributions_paused());
    }

    // disallow_token: no admin configured.
    {
        let env = Env::default();
        env.mock_all_auths();

        let client = make_client(&env);
        let caller = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token = env.register_stellar_asset_contract(token_admin);

        let result = client.try_disallow_token(&caller, &token);

        assert_eq!(result, Err(Ok(SplitError::AdminNotSet)));
    }

    // disallow_token: configured admin rejects attacker.
    {
        let env = Env::default();
        env.mock_all_auths();

        let client = make_client(&env);
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

    // migrate_flat_to_buckets: no admin configured.
    {
        let env = Env::default();
        env.mock_all_auths();

        let client = make_client(&env);
        let caller = Address::generate(&env);

        let result = client.try_migrate_flat_to_buckets(&caller);

        assert_eq!(result, Err(Ok(SplitError::AdminNotSet)));
    }

    // migrate_flat_to_buckets: configured admin rejects attacker.
    {
        let env = Env::default();
        env.mock_all_auths();

        let client = make_client(&env);
        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);

        client.set_admin(&admin);

        let result = client.try_migrate_flat_to_buckets(&attacker);

        assert_eq!(result, Err(Ok(SplitError::Unauthorized)));
    }
}

// -----------------------------------------------------------------------------
// 4. Collaborator-gated claim
// -----------------------------------------------------------------------------

/// A caller who is not a registered collaborator must not be able to claim
/// project funds.
///
/// The rejected claim must not modify either the project's balance or the
/// caller's claimed amount.
#[test]
fn test_claim_rejects_non_collaborator_and_preserves_state() {
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

    assert_eq!(
        client.get_balance(&project_id),
        before_balance,
        "rejected claim must not change project balance"
    );

    assert_eq!(
        client.get_claimed(&project_id, &outsider),
        before_claimed,
        "rejected claim must not create or modify claim state"
    );
}

/// A claim against a nonexistent project must return `NotFound` before the
/// collaborator authorization check is evaluated.
#[test]
fn test_claim_on_nonexistent_project_returns_not_found() {
    let env = Env::default();
    env.mock_all_auths();

    let client = make_client(&env);
    let project_id = Symbol::new(&env, "missing_claim");
    let caller = Address::generate(&env);

    let result = client.try_claim(&project_id, &caller);

    assert_eq!(result, Err(Ok(SplitError::NotFound)));
}

// -----------------------------------------------------------------------------
// 5. Permissionless distribution
// -----------------------------------------------------------------------------

/// `distribute` is intentionally permissionless.
///
/// No caller authorization is required because the operation distributes
/// project funds according to the collaborators already stored on-chain.
/// This test ensures that the endpoint does not accidentally acquire an
/// owner/admin authorization requirement.
#[test]
fn test_distribute_is_permissionless() {
    let env = Env::default();
    env.mock_all_auths();

    let project_id = Symbol::new(&env, "permissionless_dist");
    let (client, owner, token) = setup_project(&env, &project_id);

    deposit_to_project(
        &env,
        &client,
        &token,
        &project_id,
        &owner,
        1_000_0000000i128,
    );

    // Remove all explicit authorization entries. A require_auth-gated
    // operation would fail at the host authorization layer.
    env.set_auths(&[]);

    let result = client.try_distribute(&project_id);

    assert!(
        result.is_ok(),
        "distribute must remain permissionless"
    );
}

// -----------------------------------------------------------------------------
// 6. Administrator rotation
// -----------------------------------------------------------------------------

/// A caller without authorization from the current administrator cannot
/// rotate the contract administrator.
///
/// `set_admin` performs authorization at the host level, so this test checks
/// for a failed invocation rather than expecting a `SplitError`.
#[test]
fn test_set_admin_rejects_unauthorized_rotation() {
    let env = Env::default();
    env.mock_all_auths();

    let client = make_client(&env);

    let original_admin = Address::generate(&env);
    let attacker = Address::generate(&env);

    client.set_admin(&original_admin);

    // Remove all authorization entries. The stored admin has not authorized
    // the attempted rotation.
    env.set_auths(&[]);

    let result = client.try_set_admin(&attacker);

    assert!(
        result.is_err(),
        "admin rotation must require authorization"
    );

    // Restore mocked authorization so we can verify the contract state.
    env.mock_all_auths();

    // The original administrator must retain control.
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract(token_admin);

    assert!(
        client.try_allow_token(&original_admin, &token).is_ok(),
        "original admin must retain control after failed rotation"
    );

    assert!(client.is_token_allowed(&token));

    // The attacker must not have acquired administrator privileges.
    assert_eq!(
        client.try_allow_token(&attacker, &token),
        Err(Ok(SplitError::Unauthorized))
    );
}

/// The current administrator can successfully transfer administrator
/// privileges to a new address.
///
/// After rotation:
/// - the new administrator can perform admin-gated operations; and
/// - the previous administrator can no longer do so.
#[test]
fn test_set_admin_successful_rotation_transfers_control() {
    let env = Env::default();
    env.mock_all_auths();

    let client = make_client(&env);

    let original_admin = Address::generate(&env);
    let new_admin = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract(token_admin);

    client.set_admin(&original_admin);

    let rotation_result = client.try_set_admin(&new_admin);

    assert!(
        rotation_result.is_ok(),
        "current admin must be able to rotate administrator"
    );

    // The new administrator has control.
    assert!(
        client.try_allow_token(&new_admin, &token).is_ok(),
        "new admin must be able to perform admin-gated operations"
    );

    assert!(client.is_token_allowed(&token));

    // The former administrator no longer has control.
    assert_eq!(
        client.try_allow_token(&original_admin, &token),
        Err(Ok(SplitError::Unauthorized))
    );
}