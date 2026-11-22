#![cfg(test)]

//! Authorization tests for the admin token operations (issue #1648).
//!
//! ## Entry points under test
//!
//! | Entry point            | Gate                     | Mutates                                        |
//! |------------------------|--------------------------|------------------------------------------------|
//! | `allow_token`          | `require_contract_admin` | `AllowedToken`, `AllowedTokenList`, `AllowedTokenCount` |
//! | `disallow_token`       | `require_contract_admin` | same as above                                  |
//! | `withdraw_unallocated` | `require_contract_admin` | contract token balance (stray funds only)      |
//!
//! `authorization_coverage_tests` and `authorization_tests` already prove an
//! *unrelated* address is rejected. This suite widens the caller matrix to the
//! personas that hold authority elsewhere in the contract and so are the most
//! plausible confused-deputy paths:
//!
//! - the **project owner** (owner-gated powers must not leak into admin powers);
//! - a **project collaborator** (claim rights must not leak into admin powers);
//! - an **unrelated** address;
//! - the **previous admin** after `set_admin` rotation.
//!
//! For every rejected call the suite asserts the exact `SplitError`, that the
//! identity check runs *before* argument validation (so a non-admin cannot
//! probe validation errors), and that the allowlist, token balances and
//! accounted project funds are byte-for-byte unchanged. Success and boundary
//! cases (idempotent allow, no-op disallow, exact-unallocated withdrawal) pin
//! the admin's positive path.

use crate::{errors::SplitError, Collaborator, SplitNairaContract, SplitNairaContractClient};
use soroban_sdk::{
    testutils::{Address as _, AuthorizedFunction},
    token, vec, Address, Env, String, Symbol, Vec,
};

/// Funds deposited into the project; these are *accounted* and must never be
/// withdrawable through `withdraw_unallocated`.
const PROJECT_FUNDS: i128 = 5_000_000;
/// Tokens sent straight to the contract address (not via `deposit`); these
/// are the only funds `withdraw_unallocated` may move.
const STRAY_FUNDS: i128 = 750_000;

struct Fixture<'a> {
    env: Env,
    client: SplitNairaContractClient<'a>,
    contract_id: Address,
    admin: Address,
    owner: Address,
    collaborator: Address,
    unrelated: Address,
    /// Token used by the project (allowlisted, funded, with stray balance).
    token: Address,
    /// A second, not-yet-allowlisted token.
    other_token: Address,
    project_id: Symbol,
}

fn fixture<'a>(env: &'a Env) -> Fixture<'a> {
    env.mock_all_auths();

    let token = env.register_stellar_asset_contract(Address::generate(env));
    let other_token = env.register_stellar_asset_contract(Address::generate(env));

    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let owner = Address::generate(env);
    let collaborator = Address::generate(env);
    let second_collaborator = Address::generate(env);
    let unrelated = Address::generate(env);

    client.set_admin(&admin);
    client.allow_token(&admin, &token);

    let collaborators: Vec<Collaborator> = vec![
        env,
        Collaborator {
            address: collaborator.clone(),
            alias: String::from_str(env, "Collaborator"),
            basis_points: 7000,
        },
        Collaborator {
            address: second_collaborator,
            alias: String::from_str(env, "Second"),
            basis_points: 3000,
        },
    ];
    let project_id = Symbol::new(env, "admin_token_authz");
    client.create_project(
        &owner,
        &project_id,
        &String::from_str(env, "Admin Token Authz"),
        &String::from_str(env, "music"),
        &token,
        &collaborators,
    );

    let asset = token::StellarAssetClient::new(env, &token);
    let funder = Address::generate(env);
    asset.mint(&funder, &PROJECT_FUNDS);
    client.deposit(&project_id, &funder, &PROJECT_FUNDS);

    // Direct transfer into the contract: unallocated "stray" funds.
    asset.mint(&contract_id, &STRAY_FUNDS);

    Fixture {
        env: env.clone(),
        client,
        contract_id,
        admin,
        owner,
        collaborator,
        unrelated,
        token,
        other_token,
        project_id,
    }
}

/// Everything an admin token operation can touch.
#[derive(Debug, PartialEq)]
struct TokenState {
    admin: Option<Address>,
    allowed_count: u32,
    allowed_list: Vec<Address>,
    token_allowed: bool,
    other_token_allowed: bool,
    contract_token_balance: i128,
    project_balance: i128,
    unallocated: i128,
}

fn token_state(f: &Fixture) -> TokenState {
    let count = f.client.get_allowed_token_count();
    TokenState {
        admin: f.client.get_admin(),
        allowed_count: count,
        allowed_list: f.client.get_allowed_tokens(&0, &count.max(1)),
        token_allowed: f.client.is_token_allowed(&f.token),
        other_token_allowed: f.client.is_token_allowed(&f.other_token),
        contract_token_balance: token::Client::new(&f.env, &f.token).balance(&f.contract_id),
        project_balance: f.client.get_balance(&f.project_id),
        unallocated: f.client.get_unallocated_balance(&f.token),
    }
}

/// Drives every admin token operation as `caller` and asserts each one is
/// rejected with `expected` without changing any token state. Invalid
/// arguments are included on purpose: the identity check must fire first, so
/// a non-admin always sees `expected` rather than a validation error.
fn assert_all_admin_token_ops_rejected(f: &Fixture, caller: &Address, expected: SplitError) {
    let before = token_state(f);

    // Allowlist management.
    assert_eq!(
        f.client.try_allow_token(caller, &f.other_token),
        Err(Ok(expected)),
        "allow_token"
    );
    assert_eq!(
        f.client.try_allow_token(caller, &f.token),
        Err(Ok(expected)),
        "allow_token (already allowed)"
    );
    assert_eq!(
        f.client.try_disallow_token(caller, &f.token),
        Err(Ok(expected)),
        "disallow_token"
    );
    assert_eq!(
        f.client.try_disallow_token(caller, &f.other_token),
        Err(Ok(expected)),
        "disallow_token (not allowed)"
    );

    // Recovery: valid request, then every validation boundary.
    assert_eq!(
        f.client
            .try_withdraw_unallocated(caller, &f.token, caller, &STRAY_FUNDS),
        Err(Ok(expected)),
        "withdraw_unallocated (exact unallocated)"
    );
    assert_eq!(
        f.client
            .try_withdraw_unallocated(caller, &f.token, caller, &1),
        Err(Ok(expected)),
        "withdraw_unallocated (one stroop)"
    );
    assert_eq!(
        f.client
            .try_withdraw_unallocated(caller, &f.token, caller, &0),
        Err(Ok(expected)),
        "withdraw_unallocated (zero amount)"
    );
    assert_eq!(
        f.client
            .try_withdraw_unallocated(caller, &f.token, caller, &(-1)),
        Err(Ok(expected)),
        "withdraw_unallocated (negative amount)"
    );
    assert_eq!(
        f.client
            .try_withdraw_unallocated(caller, &f.token, &f.contract_id, &1),
        Err(Ok(expected)),
        "withdraw_unallocated (contract recipient)"
    );
    assert_eq!(
        f.client
            .try_withdraw_unallocated(caller, &f.token, caller, &(STRAY_FUNDS + PROJECT_FUNDS)),
        Err(Ok(expected)),
        "withdraw_unallocated (overdraw into project funds)"
    );

    assert_eq!(
        token_state(f),
        before,
        "rejected calls must not mutate state"
    );
}

/// True when the last invocation demanded `signer`'s authorization for a
/// root call to `fn_name`.
fn demands_authorization(env: &Env, signer: &Address, fn_name: &str) -> bool {
    env.auths().iter().any(|(addr, invocation)| {
        addr == signer
            && matches!(
                &invocation.function,
                AuthorizedFunction::Contract((_, name, _)) if *name == Symbol::new(env, fn_name)
            )
    })
}

// -----------------------------------------------------------------------------
// Caller matrix: rejected personas
// -----------------------------------------------------------------------------

#[test]
fn project_owner_cannot_perform_admin_token_operations() {
    let env = Env::default();
    let f = fixture(&env);

    assert_all_admin_token_ops_rejected(&f, &f.owner, SplitError::Unauthorized);

    // The owner's own project-level powers are untouched by the rejections.
    let project = f.client.get_project(&f.project_id).unwrap();
    assert_eq!(project.owner, f.owner);
}

#[test]
fn project_collaborator_cannot_perform_admin_token_operations() {
    let env = Env::default();
    let f = fixture(&env);

    assert_all_admin_token_ops_rejected(&f, &f.collaborator, SplitError::Unauthorized);

    // Claim rights still work: rejection did not disturb the payout ledger.
    assert_eq!(
        f.client.claim(&f.project_id, &f.collaborator),
        PROJECT_FUNDS * 7000 / 10_000
    );
}

#[test]
fn unrelated_caller_cannot_perform_admin_token_operations() {
    let env = Env::default();
    let f = fixture(&env);

    assert_all_admin_token_ops_rejected(&f, &f.unrelated, SplitError::Unauthorized);
}

#[test]
fn previous_admin_loses_admin_token_operations_after_rotation() {
    let env = Env::default();
    let f = fixture(&env);

    let new_admin = Address::generate(&f.env);
    f.client.set_admin(&new_admin);
    assert_eq!(f.client.get_admin(), Some(new_admin.clone()));

    assert_all_admin_token_ops_rejected(&f, &f.admin, SplitError::Unauthorized);

    // The rotated-in admin holds the full set of token powers.
    f.client.allow_token(&new_admin, &f.other_token);
    assert!(f.client.is_token_allowed(&f.other_token));
    f.client
        .withdraw_unallocated(&new_admin, &f.token, &new_admin, &STRAY_FUNDS);
    assert_eq!(
        token::Client::new(&f.env, &f.token).balance(&new_admin),
        STRAY_FUNDS
    );
}

#[test]
fn every_persona_is_rejected_with_admin_not_set_before_configuration() {
    let env = Env::default();
    env.mock_all_auths();

    let token = env.register_stellar_asset_contract(Address::generate(&env));
    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let project_id = Symbol::new(&env, "no_admin_yet");
    client.create_project(
        &owner,
        &project_id,
        &String::from_str(&env, "No Admin"),
        &String::from_str(&env, "music"),
        &token,
        &vec![
            &env,
            Collaborator {
                address: alice.clone(),
                alias: String::from_str(&env, "Alice"),
                basis_points: 5000,
            },
            Collaborator {
                address: bob,
                alias: String::from_str(&env, "Bob"),
                basis_points: 5000,
            },
        ],
    );
    token::StellarAssetClient::new(&env, &token).mint(&contract_id, &STRAY_FUNDS);

    for caller in [owner, alice, Address::generate(&env)] {
        assert_eq!(
            client.try_allow_token(&caller, &token),
            Err(Ok(SplitError::AdminNotSet))
        );
        assert_eq!(
            client.try_disallow_token(&caller, &token),
            Err(Ok(SplitError::AdminNotSet))
        );
        assert_eq!(
            client.try_withdraw_unallocated(&caller, &token, &caller, &STRAY_FUNDS),
            Err(Ok(SplitError::AdminNotSet))
        );
        // AdminNotSet also precedes amount validation.
        assert_eq!(
            client.try_withdraw_unallocated(&caller, &token, &caller, &0),
            Err(Ok(SplitError::AdminNotSet))
        );
    }

    assert_eq!(client.get_allowed_token_count(), 0);
    assert!(!client.is_token_allowed(&token));
    assert_eq!(
        token::Client::new(&env, &token).balance(&contract_id),
        STRAY_FUNDS
    );
}

// -----------------------------------------------------------------------------
// Admin success and boundary cases
// -----------------------------------------------------------------------------

#[test]
fn admin_token_operations_demand_the_stored_admin_signature() {
    let env = Env::default();
    let f = fixture(&env);

    f.client.allow_token(&f.admin, &f.other_token);
    assert!(demands_authorization(&f.env, &f.admin, "allow_token"));

    f.client.disallow_token(&f.admin, &f.other_token);
    assert!(demands_authorization(&f.env, &f.admin, "disallow_token"));

    f.client
        .withdraw_unallocated(&f.admin, &f.token, &f.unrelated, &1);
    assert!(demands_authorization(
        &f.env,
        &f.admin,
        "withdraw_unallocated"
    ));
    // The recipient is a beneficiary, not a signer.
    assert!(!demands_authorization(
        &f.env,
        &f.unrelated,
        "withdraw_unallocated"
    ));
}

#[test]
fn admin_allow_is_idempotent_and_disallow_of_unknown_token_is_a_no_op() {
    let env = Env::default();
    let f = fixture(&env);

    // Re-allowing an already-allowlisted token must not double count it.
    f.client.allow_token(&f.admin, &f.token);
    assert_eq!(f.client.get_allowed_token_count(), 1);
    assert_eq!(
        f.client.get_allowed_tokens(&0, &10),
        vec![&f.env, f.token.clone()]
    );

    // Disallowing a token that was never listed succeeds without underflow.
    f.client.disallow_token(&f.admin, &f.other_token);
    assert_eq!(f.client.get_allowed_token_count(), 1);
    assert!(f.client.is_token_allowed(&f.token));

    // Full cycle back to an empty allowlist keeps count and list consistent.
    f.client.disallow_token(&f.admin, &f.token);
    assert_eq!(f.client.get_allowed_token_count(), 0);
    assert!(f.client.get_allowed_tokens(&0, &10).is_empty());
    f.client.disallow_token(&f.admin, &f.token);
    assert_eq!(
        f.client.get_allowed_token_count(),
        0,
        "count never underflows"
    );
}

#[test]
fn admin_withdrawal_is_bounded_by_unallocated_funds_exactly() {
    let env = Env::default();
    let f = fixture(&env);
    let recipient = Address::generate(&f.env);

    assert_eq!(f.client.get_unallocated_balance(&f.token), STRAY_FUNDS);

    // One stroop above the unallocated amount would dip into project funds.
    assert_eq!(
        f.client
            .try_withdraw_unallocated(&f.admin, &f.token, &recipient, &(STRAY_FUNDS + 1)),
        Err(Ok(SplitError::InsufficientUnallocated))
    );

    // The minimum (one stroop) and then the exact remainder both succeed.
    f.client
        .withdraw_unallocated(&f.admin, &f.token, &recipient, &1);
    f.client
        .withdraw_unallocated(&f.admin, &f.token, &recipient, &(STRAY_FUNDS - 1));

    let balance = token::Client::new(&f.env, &f.token);
    assert_eq!(balance.balance(&recipient), STRAY_FUNDS);
    assert_eq!(f.client.get_unallocated_balance(&f.token), 0);
    assert_eq!(f.client.get_balance(&f.project_id), PROJECT_FUNDS);
    assert_eq!(balance.balance(&f.contract_id), PROJECT_FUNDS);

    // With nothing unallocated, even the admin cannot move a single stroop.
    assert_eq!(
        f.client
            .try_withdraw_unallocated(&f.admin, &f.token, &recipient, &1),
        Err(Ok(SplitError::InsufficientUnallocated))
    );

    // Accounted funds are still fully distributable afterwards.
    f.client.distribute(&f.project_id);
    assert_eq!(balance.balance(&f.contract_id), 0);
}

#[test]
fn disallowing_a_token_does_not_strand_existing_project_funds() {
    let env = Env::default();
    let f = fixture(&env);

    f.client.disallow_token(&f.admin, &f.token);
    f.client.allow_token(&f.admin, &f.other_token);
    assert!(!f.client.is_token_allowed(&f.token));

    // Allowlisting only gates *new* projects: the existing project's funds
    // and stray-fund recovery on the delisted token both keep working.
    f.client
        .withdraw_unallocated(&f.admin, &f.token, &f.admin, &STRAY_FUNDS);
    f.client.distribute(&f.project_id);
    assert_eq!(f.client.get_balance(&f.project_id), 0);
    assert_eq!(
        f.client
            .get_project(&f.project_id)
            .unwrap()
            .total_distributed,
        PROJECT_FUNDS
    );
}
