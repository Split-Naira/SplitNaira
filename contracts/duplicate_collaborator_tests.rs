#![cfg(test)]

//! Duplicate collaborator address semantics (issue #1646).
//!
//! ## Defined semantics
//!
//! A collaborator list is validated by `validate_collaborators`, shared by
//! `create_project` and `update_collaborators`:
//!
//! 1. Length checks run first (`TooFewCollaborators`, `TooManyCollaborators`).
//! 2. Entries are then checked one by one, in list order. For each entry the
//!    zero-share check (`ZeroShare`) runs before the duplicate check
//!    (`DuplicateCollaborator`). So the *first* offending entry decides the
//!    error.
//! 3. The basis-point total (`InvalidSplit`) is only checked after every entry
//!    passed, so a duplicate is reported even when the shares also fail to sum
//!    to 10 000.
//!
//! An address is a duplicate only when it appears twice **in the same list**.
//! Aliases and shares are ignored. The same address may be the project owner
//! and a collaborator, may appear in several projects, and may be kept (once)
//! when the list is replaced by `update_collaborators`.
//!
//! A rejected `create_project` must not create the project or touch the
//! project index. A rejected `update_collaborators` must leave the stored
//! collaborators, the pending balance and the event stream exactly as before.

use crate::{errors::SplitError, Collaborator, SplitNairaContract, SplitNairaContractClient};
use soroban_sdk::{
    testutils::{Address as _, Events},
    token, vec, Address, Env, String, Symbol, Vec,
};

fn collab(env: &Env, address: &Address, alias: &str, basis_points: u32) -> Collaborator {
    Collaborator {
        address: address.clone(),
        alias: String::from_str(env, alias),
        basis_points,
    }
}

struct Fixture<'a> {
    env: Env,
    client: SplitNairaContractClient<'a>,
    token: Address,
    owner: Address,
}

fn fixture<'a>(env: &'a Env) -> Fixture<'a> {
    env.mock_all_auths();
    let token = env.register_stellar_asset_contract(Address::generate(env));
    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(env, &contract_id);
    Fixture {
        env: env.clone(),
        client,
        token,
        owner: Address::generate(env),
    }
}

impl<'a> Fixture<'a> {
    fn try_create(&self, id: &Symbol, collaborators: &Vec<Collaborator>) -> Result<(), SplitError> {
        match self.client.try_create_project(
            &self.owner,
            id,
            &String::from_str(&self.env, "Duplicate Semantics"),
            &String::from_str(&self.env, "music"),
            &self.token,
            collaborators,
        ) {
            Ok(_) => Ok(()),
            Err(Ok(error)) => Err(error),
            Err(Err(error)) => panic!("unexpected host error: {:?}", error),
        }
    }

    fn create(&self, id: &Symbol, collaborators: &Vec<Collaborator>) {
        self.try_create(id, collaborators).expect("project created");
    }

    fn fund(&self, id: &Symbol, amount: i128) {
        let funder = Address::generate(&self.env);
        token::StellarAssetClient::new(&self.env, &self.token).mint(&funder, &amount);
        self.client.deposit(id, &funder, &amount);
    }
}

/// Asserts a rejected create left no trace of the project.
fn assert_create_rejected(
    f: &Fixture,
    id: &Symbol,
    collaborators: &Vec<Collaborator>,
    expected: SplitError,
) {
    let count_before = f.client.get_project_count();
    let ids_before = f.client.get_project_ids(&0, &100);

    assert_eq!(f.try_create(id, collaborators), Err(expected));

    assert!(!f.client.project_exists(id), "project must not exist");
    assert!(f.client.get_project(id).is_none());
    assert_eq!(f.client.get_project_count(), count_before);
    assert_eq!(f.client.get_project_ids(&0, &100), ids_before);
    assert_eq!(
        f.client.try_get_balance(id),
        Err(Ok(SplitError::NotFound)),
        "no balance entry may be written"
    );
}

/// Comparable view of a stored collaborator list.
fn entries(env: &Env, collaborators: &Vec<Collaborator>) -> Vec<(Address, String, u32)> {
    let mut out = Vec::new(env);
    for c in collaborators.iter() {
        out.push_back((c.address, c.alias, c.basis_points));
    }
    out
}

// -----------------------------------------------------------------------------
// create_project
// -----------------------------------------------------------------------------

#[test]
fn create_rejects_duplicates_at_any_position_regardless_of_alias_and_share() {
    let env = Env::default();
    let f = fixture(&env);
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let c = Address::generate(&env);

    // First and last entries collide (non-adjacent), aliases and shares differ.
    assert_create_rejected(
        &f,
        &Symbol::new(&env, "dup_first_last"),
        &vec![
            &env,
            collab(&env, &a, "Alpha", 2000),
            collab(&env, &b, "Bravo", 3000),
            collab(&env, &c, "Charlie", 1000),
            collab(&env, &a, "Alpha again", 4000),
        ],
        SplitError::DuplicateCollaborator,
    );

    // Identical entries (same alias and share) are still a duplicate.
    assert_create_rejected(
        &f,
        &Symbol::new(&env, "dup_identical"),
        &vec![
            &env,
            collab(&env, &a, "Same", 5000),
            collab(&env, &a, "Same", 5000),
        ],
        SplitError::DuplicateCollaborator,
    );

    // An address listed three times is rejected on its first repetition.
    assert_create_rejected(
        &f,
        &Symbol::new(&env, "dup_triple"),
        &vec![
            &env,
            collab(&env, &b, "B1", 3334),
            collab(&env, &b, "B2", 3333),
            collab(&env, &b, "B3", 3333),
        ],
        SplitError::DuplicateCollaborator,
    );

    assert_eq!(f.client.get_project_count(), 0);
}

#[test]
fn create_duplicate_check_ordering_against_other_validation_errors() {
    let env = Env::default();
    let f = fixture(&env);
    let a = Address::generate(&env);
    let b = Address::generate(&env);

    // Duplicate wins over a bad total: shares sum to 11 000 here.
    assert_create_rejected(
        &f,
        &Symbol::new(&env, "dup_bad_total"),
        &vec![
            &env,
            collab(&env, &a, "A", 5000),
            collab(&env, &a, "A", 6000),
        ],
        SplitError::DuplicateCollaborator,
    );

    // Zero share on the repeated entry is reported first: the zero-share
    // check runs before the duplicate check for each entry.
    assert_create_rejected(
        &f,
        &Symbol::new(&env, "dup_zero_second"),
        &vec![
            &env,
            collab(&env, &a, "A", 10_000),
            collab(&env, &a, "A", 0),
        ],
        SplitError::ZeroShare,
    );

    // A zero share that comes *after* the duplicate does not mask it.
    assert_create_rejected(
        &f,
        &Symbol::new(&env, "dup_then_zero"),
        &vec![
            &env,
            collab(&env, &a, "A", 5000),
            collab(&env, &a, "A", 5000),
            collab(&env, &b, "B", 0),
        ],
        SplitError::DuplicateCollaborator,
    );

    // Length checks precede per-entry checks: a list over the cap made of one
    // repeated address reports TooManyCollaborators.
    f.client.set_admin(&f.owner);
    f.client.set_max_collaborators(&f.owner, &2);
    assert_create_rejected(
        &f,
        &Symbol::new(&env, "dup_over_cap"),
        &vec![
            &env,
            collab(&env, &a, "A", 4000),
            collab(&env, &a, "A", 3000),
            collab(&env, &a, "A", 3000),
        ],
        SplitError::TooManyCollaborators,
    );
}

#[test]
fn create_allows_owner_as_collaborator_and_same_address_across_projects() {
    let env = Env::default();
    let f = fixture(&env);
    let shared = Address::generate(&env);

    // The owner listed once as a collaborator is not a duplicate.
    let first = Symbol::new(&env, "owner_is_collab");
    f.create(
        &first,
        &vec![
            &env,
            collab(&env, &f.owner, "Owner", 5000),
            collab(&env, &shared, "Shared", 5000),
        ],
    );

    // The same collaborator in a second project is allowed: uniqueness is
    // scoped to one list, not to the whole contract.
    let second = Symbol::new(&env, "shared_collab");
    f.create(
        &second,
        &vec![
            &env,
            collab(&env, &shared, "Shared", 2500),
            collab(&env, &Address::generate(&env), "Other", 7500),
        ],
    );

    assert_eq!(f.client.get_project_count(), 2);

    // Payout ledgers stay per project for the shared address.
    f.fund(&first, 1_000);
    f.fund(&second, 1_000);
    f.client.distribute(&first);
    assert_eq!(f.client.get_claimed(&first, &shared), 500);
    assert_eq!(f.client.get_claimed(&second, &shared), 0);
    f.client.distribute(&second);
    assert_eq!(f.client.get_claimed(&second, &shared), 250);
    assert_eq!(f.client.get_claimed(&first, &shared), 500);
}

// -----------------------------------------------------------------------------
// update_collaborators
// -----------------------------------------------------------------------------

#[test]
fn rejected_duplicate_update_preserves_collaborators_balance_and_events() {
    let env = Env::default();
    let f = fixture(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let carol = Address::generate(&env);

    let id = Symbol::new(&env, "dup_update");
    let original = vec![
        &env,
        collab(&env, &alice, "Alice", 6000),
        collab(&env, &bob, "Bob", 4000),
    ];
    f.create(&id, &original);
    f.fund(&id, 10_000);

    let stored_before = entries(&env, &f.client.get_project(&id).unwrap().collaborators);
    let events_before = env.events().all().len();

    let rejected_lists = [
        // An existing collaborator repeated.
        vec![
            &env,
            collab(&env, &alice, "Alice", 5000),
            collab(&env, &alice, "Alice 2", 5000),
        ],
        // A brand-new address repeated.
        vec![
            &env,
            collab(&env, &alice, "Alice", 4000),
            collab(&env, &carol, "Carol", 3000),
            collab(&env, &carol, "Carol 2", 3000),
        ],
        // Duplicate whose shares also fail to total 10 000.
        vec![
            &env,
            collab(&env, &bob, "Bob", 9000),
            collab(&env, &bob, "Bob", 9000),
        ],
    ];

    for list in rejected_lists.iter() {
        assert_eq!(
            f.client.try_update_collaborators(&id, &f.owner, list),
            Err(Ok(SplitError::DuplicateCollaborator))
        );
        // No CollaboratorsUpdated or SplitsUpdatedWithPendingBalance event.
        assert_eq!(env.events().all().len(), events_before);

        let project = f.client.get_project(&id).unwrap();
        assert_eq!(entries(&env, &project.collaborators), stored_before);
        assert!(!project.locked);
        assert_eq!(project.distribution_round, 0);
        assert_eq!(f.client.get_balance(&id), 10_000);
    }

    // The pending balance is still distributed with the original split.
    f.client.distribute(&id);
    assert_eq!(f.client.get_claimed(&id, &alice), 6_000);
    assert_eq!(f.client.get_claimed(&id, &bob), 4_000);
    assert_eq!(f.client.get_claimed(&id, &carol), 0);
}

#[test]
fn update_may_keep_existing_addresses_once_with_new_order_and_shares() {
    let env = Env::default();
    let f = fixture(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let carol = Address::generate(&env);

    let id = Symbol::new(&env, "dup_update_ok");
    f.create(
        &id,
        &vec![
            &env,
            collab(&env, &alice, "Alice", 6000),
            collab(&env, &bob, "Bob", 4000),
        ],
    );

    // Re-using every current address exactly once (reordered, re-weighted)
    // and adding a new one is not a duplicate.
    let replacement = vec![
        &env,
        collab(&env, &bob, "Bob", 5000),
        collab(&env, &carol, "Carol", 2000),
        collab(&env, &alice, "Alice", 3000),
    ];
    f.client.update_collaborators(&id, &f.owner, &replacement);
    assert_eq!(
        entries(&env, &f.client.get_project(&id).unwrap().collaborators),
        entries(&env, &replacement)
    );

    // Duplicate detection runs against the *new* list only: carol is now
    // stored, and listing her twice in a further update is still rejected.
    assert_eq!(
        f.client.try_update_collaborators(
            &id,
            &f.owner,
            &vec![
                &env,
                collab(&env, &carol, "Carol", 5000),
                collab(&env, &carol, "Carol", 5000),
            ],
        ),
        Err(Ok(SplitError::DuplicateCollaborator))
    );
    assert_eq!(
        entries(&env, &f.client.get_project(&id).unwrap().collaborators),
        entries(&env, &replacement)
    );
}

#[test]
fn update_duplicate_is_not_reached_when_caller_or_lock_state_is_invalid() {
    let env = Env::default();
    let f = fixture(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    let id = Symbol::new(&env, "dup_update_gate");
    f.create(
        &id,
        &vec![
            &env,
            collab(&env, &alice, "Alice", 5000),
            collab(&env, &bob, "Bob", 5000),
        ],
    );
    let duplicated = vec![
        &env,
        collab(&env, &alice, "Alice", 5000),
        collab(&env, &alice, "Alice", 5000),
    ];

    // Missing project and wrong owner are reported before list validation.
    assert_eq!(
        f.client
            .try_update_collaborators(&Symbol::new(&env, "missing"), &f.owner, &duplicated),
        Err(Ok(SplitError::NotFound))
    );
    assert_eq!(
        f.client
            .try_update_collaborators(&id, &Address::generate(&env), &duplicated),
        Err(Ok(SplitError::Unauthorized))
    );

    // Once locked, the lock is reported instead of the duplicate.
    f.client.lock_project(&id, &f.owner);
    assert_eq!(
        f.client
            .try_update_collaborators(&id, &f.owner, &duplicated),
        Err(Ok(SplitError::ProjectLocked))
    );

    let project = f.client.get_project(&id).unwrap();
    assert_eq!(project.collaborators.len(), 2);
    assert_eq!(project.collaborators.get(0).unwrap().address, alice);
    assert_eq!(project.collaborators.get(1).unwrap().address, bob);
}
