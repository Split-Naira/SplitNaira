#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::{Address as _, Events as _}, token, Address, Env, String, Symbol, Vec};

// ============================================================
//  TEST HELPERS
// ============================================================

fn create_test_env() -> (Env, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    // Deploy a mock token contract (represents USDC or XLM)
    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract(token_admin.clone());

    (env, token_admin, token_contract)
}

fn make_collaborators(env: &Env, addresses: Vec<Address>, bps: Vec<u32>) -> Vec<Collaborator> {
    let mut collabs = Vec::new(env);
    for (addr, bp) in addresses.iter().zip(bps.iter()) {
        collabs.push_back(Collaborator {
            address: addr.clone(),
            alias: String::from_str(env, "Test User"),
            basis_points: bp,
        });
    }
    collabs
}

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

// ============================================================
//  CREATION TESTS
// ============================================================

#[test]
fn test_create_project_success() {
    let (env, _admin, token) = create_test_env();
    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    let collabs = make_collaborators(
        &env,
        Vec::from_slice(&env, &[alice.clone(), bob.clone()]),
        Vec::from_slice(&env, &[6000u32, 4000u32]), // 60% / 40%
    );

    client.create_project(
        &owner,
        &Symbol::new(&env, "afrobeats_vol3"),
        &String::from_str(&env, "Afrobeats Vol. 3"),
        &String::from_str(&env, "music"),
        &token,
        &collabs,
    );
    assert_eq!(client.get_project_count(), 1);

    let project = client
        .get_project(&Symbol::new(&env, "afrobeats_vol3"))
        .unwrap();
    assert_eq!(project.collaborators.len(), 2);
    assert_eq!(project.locked, false);
    assert_eq!(project.total_distributed, 0);
    assert_eq!(project.distribution_round, 0);
    assert_eq!(client.get_balance(&Symbol::new(&env, "afrobeats_vol3")), 0);
}

#[test]
fn test_create_project_fails_invalid_split() {
    let (env, _admin, token) = create_test_env();
    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // 60% + 30% = 90% — does NOT sum to 100%
    let collabs = make_collaborators(
        &env,
        Vec::from_slice(&env, &[alice.clone(), bob.clone()]),
        Vec::from_slice(&env, &[6000u32, 3000u32]),
    );

    let result = client.try_create_project(
        &owner,
        &Symbol::new(&env, "bad_split"),
        &String::from_str(&env, "Bad Split Project"),
        &String::from_str(&env, "music"),
        &token,
        &collabs,
    );

    assert_eq!(result, Err(Ok(SplitError::InvalidSplit)));
}

#[test]
fn test_create_project_fails_too_few_collaborators() {
    let (env, _admin, token) = create_test_env();
    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let alice = Address::generate(&env);

    // Only 1 collaborator — minimum is 2
    let collabs = make_collaborators(
        &env,
        Vec::from_slice(&env, &[alice.clone()]),
        Vec::from_slice(&env, &[10000u32]),
    );

    let result = client.try_create_project(
        &owner,
        &Symbol::new(&env, "solo"),
        &String::from_str(&env, "Solo Project"),
        &String::from_str(&env, "art"),
        &token,
        &collabs,
    );

    assert_eq!(result, Err(Ok(SplitError::TooFewCollaborators)));
}

#[test]
fn test_create_project_fails_duplicate_id() {
    let (env, _admin, token) = create_test_env();
    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let collabs = make_collaborators(
        &env,
        Vec::from_slice(&env, &[alice.clone(), bob.clone()]),
        Vec::from_slice(&env, &[5000u32, 5000u32]),
    );

    // First creation — should succeed
    client.create_project(
        &owner,
        &Symbol::new(&env, "dup_test"),
        &String::from_str(&env, "Duplicate Test"),
        &String::from_str(&env, "film"),
        &token,
        &collabs.clone(),
    );

    // Second creation with same ID — should fail
    let result = client.try_create_project(
        &owner,
        &Symbol::new(&env, "dup_test"),
        &String::from_str(&env, "Duplicate Test"),
        &String::from_str(&env, "film"),
        &token,
        &collabs,
    );

    assert_eq!(result, Err(Ok(SplitError::ProjectExists)));
}

#[test]
fn test_create_project_fails_duplicate_collaborator_address() {
    let (env, _admin, token) = create_test_env();
    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let alice = Address::generate(&env);

    // Same address appears twice — should fail.
    let collabs = make_collaborators(
        &env,
        Vec::from_slice(&env, &[alice.clone(), alice.clone()]),
        Vec::from_slice(&env, &[5000u32, 5000u32]),
    );

    let result = client.try_create_project(
        &owner,
        &Symbol::new(&env, "dup_address"),
        &String::from_str(&env, "Duplicate Address"),
        &String::from_str(&env, "music"),
        &token,
        &collabs,
    );

    assert_eq!(result, Err(Ok(SplitError::DuplicateCollaborator)));
}

#[test]
fn test_create_project_allows_any_token_when_allowlist_is_empty() {
    let (env, _admin, _token_a) = create_test_env();
    let token_b_admin = Address::generate(&env);
    let token_b = env.register_stellar_asset_contract(token_b_admin);

    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let collabs = make_collaborators(
        &env,
        Vec::from_slice(&env, &[alice, bob]),
        Vec::from_slice(&env, &[5000u32, 5000u32]),
    );

    client.create_project(
        &owner,
        &Symbol::new(&env, "allowlist_off"),
        &String::from_str(&env, "Allowlist Off"),
        &String::from_str(&env, "music"),
        &token_b,
        &collabs,
    );

    assert_eq!(client.get_project_count(), 1);
}

#[test]
fn test_create_project_fails_when_token_not_allowlisted() {
    let (env, _admin, token_a) = create_test_env();
    let token_b_admin = Address::generate(&env);
    let token_b = env.register_stellar_asset_contract(token_b_admin);

    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);

    let contract_admin = Address::generate(&env);
    client.set_admin(&contract_admin);
    client.allow_token(&contract_admin, &token_a);

    let owner = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let collabs = make_collaborators(
        &env,
        Vec::from_slice(&env, &[alice, bob]),
        Vec::from_slice(&env, &[5000u32, 5000u32]),
    );

    let result = client.try_create_project(
        &owner,
        &Symbol::new(&env, "token_blocked"),
        &String::from_str(&env, "Token Blocked"),
        &String::from_str(&env, "film"),
        &token_b,
        &collabs,
    );

    assert_eq!(result, Err(Ok(SplitError::TokenNotAllowed)));
}

#[test]
fn test_create_project_succeeds_when_token_is_allowlisted() {
    let (env, _admin, token) = create_test_env();
    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);

    let contract_admin = Address::generate(&env);
    client.set_admin(&contract_admin);
    client.allow_token(&contract_admin, &token);

    let owner = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let collabs = make_collaborators(
        &env,
        Vec::from_slice(&env, &[alice, bob]),
        Vec::from_slice(&env, &[6000u32, 4000u32]),
    );

    client.create_project(
        &owner,
        &Symbol::new(&env, "token_allowed"),
        &String::from_str(&env, "Token Allowed"),
        &String::from_str(&env, "music"),
        &token,
        &collabs,
    );

    assert_eq!(client.get_project_count(), 1);
}

#[test]
fn test_allowlist_management_requires_admin() {
    let (env, _admin, token) = create_test_env();
    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let unauthorized = Address::generate(&env);

    let before_admin = client.try_allow_token(&admin, &token);
    assert_eq!(before_admin, Err(Ok(SplitError::AdminNotSet)));

    client.set_admin(&admin);
    let admin_from_storage = client.get_admin().unwrap();
    assert_eq!(admin_from_storage, admin);

    let unauthorized_result = client.try_allow_token(&unauthorized, &token);
    assert_eq!(unauthorized_result, Err(Ok(SplitError::Unauthorized)));

    client.allow_token(&admin, &token);
    assert_eq!(client.is_token_allowed(&token), true);
    assert_eq!(client.get_allowed_token_count(), 1);
}

#[test]
fn test_allowlist_turns_off_after_last_token_is_removed() {
    let (env, _admin, token_a) = create_test_env();
    let token_b_admin = Address::generate(&env);
    let token_b = env.register_stellar_asset_contract(token_b_admin);

    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);

    let contract_admin = Address::generate(&env);
    client.set_admin(&contract_admin);
    client.allow_token(&contract_admin, &token_a);
    assert_eq!(client.get_allowed_token_count(), 1);

    client.disallow_token(&contract_admin, &token_a);
    assert_eq!(client.get_allowed_token_count(), 0);
    assert_eq!(client.is_token_allowed(&token_a), false);

    // Allowlist is now off (empty), so non-allowlisted token should work.
    let owner = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let collabs = make_collaborators(
        &env,
        Vec::from_slice(&env, &[alice, bob]),
        Vec::from_slice(&env, &[5000u32, 5000u32]),
    );
    client.create_project(
        &owner,
        &Symbol::new(&env, "allowlist_cleared"),
        &String::from_str(&env, "Allowlist Cleared"),
        &String::from_str(&env, "art"),
        &token_b,
        &collabs,
    );

    assert_eq!(client.get_project_count(), 1);
}

// ============================================================
//  UPDATE + LOCK TESTS
// ============================================================

#[test]
fn test_update_collaborators_success_before_lock() {
    let (env, _admin, token) = create_test_env();
    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let carol = Address::generate(&env);

    let initial_collabs = make_collaborators(
        &env,
        Vec::from_slice(&env, &[alice.clone(), bob.clone()]),
        Vec::from_slice(&env, &[6000u32, 4000u32]),
    );

    client.create_project(
        &owner,
        &Symbol::new(&env, "editable_split"),
        &String::from_str(&env, "Editable Split"),
        &String::from_str(&env, "music"),
        &token,
        &initial_collabs,
    );

    let updated_collabs = make_collaborators(
        &env,
        Vec::from_slice(&env, &[alice.clone(), bob.clone(), carol.clone()]),
        Vec::from_slice(&env, &[5000u32, 3000u32, 2000u32]),
    );

    client.update_collaborators(
        &Symbol::new(&env, "editable_split"),
        &owner,
        &updated_collabs,
    );

    let project = client
        .get_project(&Symbol::new(&env, "editable_split"))
        .unwrap();
    assert_eq!(project.locked, false);
    assert_eq!(project.collaborators.len(), 3);
    assert_eq!(project.collaborators.get(0u32).unwrap().address, alice);
    assert_eq!(
        project.collaborators.get(0u32).unwrap().basis_points,
        5000u32
    );
    assert_eq!(project.collaborators.get(1u32).unwrap().address, bob);
    assert_eq!(
        project.collaborators.get(1u32).unwrap().basis_points,
        3000u32
    );
    assert_eq!(project.collaborators.get(2u32).unwrap().address, carol);
    assert_eq!(
        project.collaborators.get(2u32).unwrap().basis_points,
        2000u32
    );
}

#[test]
fn test_update_collaborators_fails_when_locked() {
    let (env, _admin, token) = create_test_env();
    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let carol = Address::generate(&env);

    let collabs = make_collaborators(
        &env,
        Vec::from_slice(&env, &[alice.clone(), bob.clone()]),
        Vec::from_slice(&env, &[7000u32, 3000u32]),
    );

    client.create_project(
        &owner,
        &Symbol::new(&env, "locked_update"),
        &String::from_str(&env, "Locked Update"),
        &String::from_str(&env, "film"),
        &token,
        &collabs,
    );
    client.lock_project(&Symbol::new(&env, "locked_update"), &owner);

    let updated_collabs = make_collaborators(
        &env,
        Vec::from_slice(&env, &[alice, bob, carol]),
        Vec::from_slice(&env, &[5000u32, 3000u32, 2000u32]),
    );

    let result = client.try_update_collaborators(
        &Symbol::new(&env, "locked_update"),
        &owner,
        &updated_collabs,
    );
    assert_eq!(result, Err(Ok(SplitError::ProjectLocked)));
}

#[test]
fn test_lock_project_success() {
    let (env, _admin, token) = create_test_env();
    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let collabs = make_collaborators(
        &env,
        Vec::from_slice(&env, &[alice, bob]),
        Vec::from_slice(&env, &[7000u32, 3000u32]),
    );

    client.create_project(
        &owner,
        &Symbol::new(&env, "nollywood_film"),
        &String::from_str(&env, "Nollywood Feature Film"),
        &String::from_str(&env, "film"),
        &token,
        &collabs,
    );

    client.lock_project(&Symbol::new(&env, "nollywood_film"), &owner);

    let project = client
        .get_project(&Symbol::new(&env, "nollywood_film"))
        .unwrap();
    assert_eq!(project.locked, true);
}

// ============================================================
//  DEPOSIT + DISTRIBUTION TESTS
// ============================================================

#[test]
fn test_distribute_splits_correctly() {
    let (env, _token_admin, token) = create_test_env();
    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let funder = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let carol = Address::generate(&env);

    // 50% / 30% / 20% split
    let collabs = make_collaborators(
        &env,
        Vec::from_slice(&env, &[alice.clone(), bob.clone(), carol.clone()]),
        Vec::from_slice(&env, &[5000u32, 3000u32, 2000u32]),
    );

    let project_id = Symbol::new(&env, "podcast_ep1");
    client.create_project(
        &owner,
        &project_id,
        &String::from_str(&env, "Podcast Episode 1"),
        &String::from_str(&env, "podcast"),
        &token,
        &collabs,
    );

    // Deposit 1000 tokens (in stroops = 1000 * 10^7) into this project only.
    deposit_to_project(
        &env,
        &client,
        &token,
        &project_id,
        &funder,
        1_000_0000000i128,
    );
    assert_eq!(client.get_balance(&project_id), 1_000_0000000i128);

    client.distribute(&project_id);

    // Check balances: 50%, 30%, 20% of 1000 tokens
    let token_balance = token::Client::new(&env, &token);
    assert_eq!(token_balance.balance(&alice), 500_0000000i128); // 50%
    assert_eq!(token_balance.balance(&bob), 300_0000000i128); // 30%
    assert_eq!(token_balance.balance(&carol), 200_0000000i128); // 20%

    // Check claimed ledger
    assert_eq!(client.get_claimed(&project_id, &alice), 500_0000000i128);

    // Check distribution metadata and project-scoped remaining balance
    let project = client.get_project(&project_id).unwrap();
    assert_eq!(project.total_distributed, 1_000_0000000i128);
    assert_eq!(project.distribution_round, 1);
    assert_eq!(client.get_balance(&project_id), 0);
}

#[test]
fn test_distribute_fails_no_balance() {
    let (env, _admin, token) = create_test_env();
    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let collabs = make_collaborators(
        &env,
        Vec::from_slice(&env, &[alice, bob]),
        Vec::from_slice(&env, &[5000u32, 5000u32]),
    );

    let project_id = Symbol::new(&env, "empty_project");
    client.create_project(
        &owner,
        &project_id,
        &String::from_str(&env, "Empty Project"),
        &String::from_str(&env, "art"),
        &token,
        &collabs,
    );

    // No project deposit — distribute should fail and round should remain 0.
    let result = client.try_distribute(&project_id);
    assert_eq!(result, Err(Ok(SplitError::NoBalance)));

    let project = client.get_project(&project_id).unwrap();
    assert_eq!(project.distribution_round, 0);
}

#[test]
fn test_distribution_round_increments_only_on_success() {
    let (env, _admin, token) = create_test_env();
    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let funder = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let collabs = make_collaborators(
        &env,
        Vec::from_slice(&env, &[alice.clone(), bob.clone()]),
        Vec::from_slice(&env, &[5000u32, 5000u32]),
    );

    let project_id = Symbol::new(&env, "round_counter");
    client.create_project(
        &owner,
        &project_id,
        &String::from_str(&env, "Round Counter"),
        &String::from_str(&env, "music"),
        &token,
        &collabs,
    );

    // Failed distribute does not increment round.
    let failed = client.try_distribute(&project_id);
    assert_eq!(failed, Err(Ok(SplitError::NoBalance)));
    assert_eq!(
        client.get_project(&project_id).unwrap().distribution_round,
        0
    );

    // First successful distribute -> round 1.
    deposit_to_project(&env, &client, &token, &project_id, &funder, 100_0000000i128);
    client.distribute(&project_id);
    assert_eq!(
        client.get_project(&project_id).unwrap().distribution_round,
        1
    );

    // Second successful distribute -> round 2.
    deposit_to_project(&env, &client, &token, &project_id, &funder, 50_0000000i128);
    client.distribute(&project_id);
    let project = client.get_project(&project_id).unwrap();
    assert_eq!(project.distribution_round, 2);
    assert_eq!(project.total_distributed, 150_0000000i128);
}

#[test]
fn test_multi_project_balances_are_isolated() {
    let (env, _admin, token) = create_test_env();
    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);

    let owner_a = Address::generate(&env);
    let owner_b = Address::generate(&env);
    let funder_a = Address::generate(&env);
    let funder_b = Address::generate(&env);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let carol = Address::generate(&env);
    let dave = Address::generate(&env);

    let project_a = Symbol::new(&env, "project_a");
    let project_b = Symbol::new(&env, "project_b");

    let collabs_a = make_collaborators(
        &env,
        Vec::from_slice(&env, &[alice.clone(), bob.clone()]),
        Vec::from_slice(&env, &[5000u32, 5000u32]),
    );
    let collabs_b = make_collaborators(
        &env,
        Vec::from_slice(&env, &[carol.clone(), dave.clone()]),
        Vec::from_slice(&env, &[7000u32, 3000u32]),
    );

    client.create_project(
        &owner_a,
        &project_a,
        &String::from_str(&env, "Project A"),
        &String::from_str(&env, "music"),
        &token,
        &collabs_a,
    );
    client.create_project(
        &owner_b,
        &project_b,
        &String::from_str(&env, "Project B"),
        &String::from_str(&env, "film"),
        &token,
        &collabs_b,
    );

    deposit_to_project(
        &env,
        &client,
        &token,
        &project_a,
        &funder_a,
        1_000_0000000i128,
    );
    deposit_to_project(
        &env,
        &client,
        &token,
        &project_b,
        &funder_b,
        2_000_0000000i128,
    );

    // Distributing project A should not consume project B funds.
    client.distribute(&project_a);

    let token_balance = token::Client::new(&env, &token);
    assert_eq!(token_balance.balance(&alice), 500_0000000i128);
    assert_eq!(token_balance.balance(&bob), 500_0000000i128);
    assert_eq!(token_balance.balance(&carol), 0);
    assert_eq!(token_balance.balance(&dave), 0);

    assert_eq!(client.get_balance(&project_a), 0);
    assert_eq!(client.get_balance(&project_b), 2_000_0000000i128);

    let project_a_data = client.get_project(&project_a).unwrap();
    let project_b_data = client.get_project(&project_b).unwrap();
    assert_eq!(project_a_data.distribution_round, 1);
    assert_eq!(project_a_data.total_distributed, 1_000_0000000i128);
    assert_eq!(project_b_data.distribution_round, 0);
    assert_eq!(project_b_data.total_distributed, 0);
}

// ============================================================
//  LIST PROJECTS TESTS (upstream — issues #49)
// ============================================================

#[test]
fn test_list_projects_empty() {
    let (env, _admin, _token) = create_test_env();
    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);

    let projects = client.list_projects(&0, &10);
    assert_eq!(projects.len(), 0);

    let project_ids = client.list_project_ids(&0, &10);
    assert_eq!(project_ids.len(), 0);
}

#[test]
fn test_list_projects_single() {
    let (env, _admin, token) = create_test_env();
    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let collabs = make_collaborators(
        &env,
        Vec::from_slice(&env, &[alice, bob]),
        Vec::from_slice(&env, &[5000u32, 5000u32]),
    );

    client.create_project(
        &owner,
        &Symbol::new(&env, "single_project"),
        &String::from_str(&env, "Single Project"),
        &String::from_str(&env, "music"),
        &token,
        &collabs,
    );

    let projects = client.list_projects(&0, &10);
    assert_eq!(projects.len(), 1);
    assert_eq!(
        projects.get(0).unwrap().project_id,
        Symbol::new(&env, "single_project")
    );

    let project_ids = client.list_project_ids(&0, &10);
    assert_eq!(project_ids.len(), 1);
    assert_eq!(
        project_ids.get(0).unwrap(),
        Symbol::new(&env, "single_project")
    );
}

#[test]
fn test_list_projects_pagination() {
    let (env, _admin, token) = create_test_env();
    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let collabs = make_collaborators(
        &env,
        Vec::from_slice(&env, &[alice.clone(), bob.clone()]),
        Vec::from_slice(&env, &[5000u32, 5000u32]),
    );

    // Create 5 projects
    for (id, title) in [
        ("proj_0", "P0"),
        ("proj_1", "P1"),
        ("proj_2", "P2"),
        ("proj_3", "P3"),
        ("proj_4", "P4"),
    ] {
        client.create_project(
            &owner,
            &Symbol::new(&env, id),
            &String::from_str(&env, title),
            &String::from_str(&env, "music"),
            &token,
            &collabs,
        );
    }

    // Test first page
    let page1 = client.list_projects(&0, &2);
    assert_eq!(page1.len(), 2);

    // Test second page
    let page2 = client.list_projects(&2, &2);
    assert_eq!(page2.len(), 2);

    // Test third page (only 1 remaining)
    let page3 = client.list_projects(&4, &2);
    assert_eq!(page3.len(), 1);

    // Test beyond bounds
    let page4 = client.list_projects(&5, &2);
    assert_eq!(page4.len(), 0);

    // Test pagination with project IDs
    let ids_page1 = client.list_project_ids(&0, &3);
    assert_eq!(ids_page1.len(), 3);
    let ids_page2 = client.list_project_ids(&3, &3);
    assert_eq!(ids_page2.len(), 2);
}

#[test]
fn test_list_projects_bounds() {
    let (env, _admin, token) = create_test_env();
    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let collabs = make_collaborators(
        &env,
        Vec::from_slice(&env, &[alice, bob]),
        Vec::from_slice(&env, &[5000u32, 5000u32]),
    );

    client.create_project(
        &owner,
        &Symbol::new(&env, "only_project"),
        &String::from_str(&env, "Only Project"),
        &String::from_str(&env, "music"),
        &token,
        &collabs,
    );

    // Start beyond total
    let projects = client.list_projects(&10, &5);
    assert_eq!(projects.len(), 0);

    // Limit larger than available
    let projects = client.list_projects(&0, &100);
    assert_eq!(projects.len(), 1);

    // Start at exact end
    let projects = client.list_projects(&1, &5);
    assert_eq!(projects.len(), 0);
}

// ============================================================
//  ISSUE #49 — get_project_ids TESTS
// ============================================================

#[test]
fn test_get_project_ids_returns_ids_in_creation_order() {
    let (env, _admin, token) = create_test_env();
    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let collabs = make_collaborators(
        &env,
        Vec::from_slice(&env, &[alice.clone(), bob.clone()]),
        Vec::from_slice(&env, &[5000u32, 5000u32]),
    );

    let id_a = Symbol::new(&env, "proj_alpha");
    let id_b = Symbol::new(&env, "proj_beta");
    let id_c = Symbol::new(&env, "proj_gamma");

    client.create_project(
        &owner,
        &id_a,
        &String::from_str(&env, "Alpha"),
        &String::from_str(&env, "music"),
        &token,
        &collabs,
    );
    client.create_project(
        &owner,
        &id_b,
        &String::from_str(&env, "Beta"),
        &String::from_str(&env, "film"),
        &token,
        &collabs,
    );
    client.create_project(
        &owner,
        &id_c,
        &String::from_str(&env, "Gamma"),
        &String::from_str(&env, "art"),
        &token,
        &collabs,
    );

    let ids = client.get_project_ids(&0u32, &10u32);
    assert_eq!(ids.len(), 3);
    assert_eq!(ids.get(0u32).unwrap(), id_a);
    assert_eq!(ids.get(1u32).unwrap(), id_b);
    assert_eq!(ids.get(2u32).unwrap(), id_c);
}

#[test]
fn test_get_project_ids_pagination() {
    let (env, _admin, token) = create_test_env();
    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let collabs = make_collaborators(
        &env,
        Vec::from_slice(&env, &[alice.clone(), bob.clone()]),
        Vec::from_slice(&env, &[5000u32, 5000u32]),
    );

    let id_a = Symbol::new(&env, "pg_alpha");
    let id_b = Symbol::new(&env, "pg_beta");
    let id_c = Symbol::new(&env, "pg_gamma");

    for (id, title) in [
        (id_a.clone(), "Alpha"),
        (id_b.clone(), "Beta"),
        (id_c.clone(), "Gamma"),
    ] {
        client.create_project(
            &owner,
            &id,
            &String::from_str(&env, title),
            &String::from_str(&env, "music"),
            &token,
            &collabs,
        );
    }

    // Page 1: start=0, limit=2
    let page1 = client.get_project_ids(&0u32, &2u32);
    assert_eq!(page1.len(), 2);
    assert_eq!(page1.get(0u32).unwrap(), id_a);
    assert_eq!(page1.get(1u32).unwrap(), id_b);

    // Page 2: start=2, limit=2 (only 1 remaining)
    let page2 = client.get_project_ids(&2u32, &2u32);
    assert_eq!(page2.len(), 1);
    assert_eq!(page2.get(0u32).unwrap(), id_c);

    // Beyond end: start=10
    let empty = client.get_project_ids(&10u32, &5u32);
    assert_eq!(empty.len(), 0);
}

#[test]
fn test_get_project_ids_empty_contract() {
    let (env, _admin, _token) = create_test_env();
    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);

    let ids = client.get_project_ids(&0u32, &10u32);
    assert_eq!(ids.len(), 0);
}

// ============================================================
//  ISSUE #50 — deposit_received EVENT TESTS
// ============================================================

#[test]
fn test_deposit_emits_deposit_received_event() {
    let (env, _admin, token) = create_test_env();
    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let funder = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let collabs = make_collaborators(
        &env,
        Vec::from_slice(&env, &[alice, bob]),
        Vec::from_slice(&env, &[5000u32, 5000u32]),
    );

    let project_id = Symbol::new(&env, "evt_deposit");
    client.create_project(
        &owner,
        &project_id,
        &String::from_str(&env, "Event Deposit"),
        &String::from_str(&env, "music"),
        &token,
        &collabs,
    );

    let amount: i128 = 500_0000000;
    let token_client = token::StellarAssetClient::new(&env, &token);
    token_client.mint(&funder, &amount);
    client.deposit(&project_id, &funder, &amount);

    // Verify balance was credited correctly
    assert_eq!(client.get_balance(&project_id), amount);

    // Verify that at least two events were emitted:
    // 1) project_created  2) deposit_received
    assert!(env.events().all().len() >= 2);
}

// ============================================================
//  ISSUE #52 — get_claimable TESTS
// ============================================================

#[test]
fn test_get_claimable_before_any_distribution() {
    let (env, _admin, token) = create_test_env();
    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let collabs = make_collaborators(
        &env,
        Vec::from_slice(&env, &[alice.clone(), bob.clone()]),
        Vec::from_slice(&env, &[6000u32, 4000u32]),
    );

    let project_id = Symbol::new(&env, "claim_before");
    client.create_project(
        &owner,
        &project_id,
        &String::from_str(&env, "Claim Before"),
        &String::from_str(&env, "music"),
        &token,
        &collabs,
    );

    let info = client.get_claimable(&project_id, &alice);
    assert_eq!(info.claimed, 0);
    assert_eq!(info.distribution_round, 0);
}

#[test]
fn test_get_claimable_after_distribution() {
    let (env, _admin, token) = create_test_env();
    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let funder = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let collabs = make_collaborators(
        &env,
        Vec::from_slice(&env, &[alice.clone(), bob.clone()]),
        Vec::from_slice(&env, &[6000u32, 4000u32]),
    );

    let project_id = Symbol::new(&env, "claim_after");
    client.create_project(
        &owner,
        &project_id,
        &String::from_str(&env, "Claim After"),
        &String::from_str(&env, "music"),
        &token,
        &collabs,
    );

    deposit_to_project(&env, &client, &token, &project_id, &funder, 1_000_0000000i128);
    client.distribute(&project_id);

    let alice_info = client.get_claimable(&project_id, &alice);
    assert_eq!(alice_info.claimed, 600_0000000i128); // 60% of 1000
    assert_eq!(alice_info.distribution_round, 1);

    let bob_info = client.get_claimable(&project_id, &bob);
    assert_eq!(bob_info.claimed, 400_0000000i128); // 40% of 1000
    assert_eq!(bob_info.distribution_round, 1);

    // Non-collaborator returns 0 claimed but correct round
    let outsider = Address::generate(&env);
    let outsider_info = client.get_claimable(&project_id, &outsider);
    assert_eq!(outsider_info.claimed, 0);
    assert_eq!(outsider_info.distribution_round, 1);
}

#[test]
fn test_get_claimable_accumulates_across_rounds() {
    let (env, _admin, token) = create_test_env();
    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let funder = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let collabs = make_collaborators(
        &env,
        Vec::from_slice(&env, &[alice.clone(), bob.clone()]),
        Vec::from_slice(&env, &[5000u32, 5000u32]),
    );

    let project_id = Symbol::new(&env, "claim_rounds");
    client.create_project(
        &owner,
        &project_id,
        &String::from_str(&env, "Claim Rounds"),
        &String::from_str(&env, "music"),
        &token,
        &collabs,
    );

    deposit_to_project(&env, &client, &token, &project_id, &funder, 200_0000000i128);
    client.distribute(&project_id);

    deposit_to_project(&env, &client, &token, &project_id, &funder, 100_0000000i128);
    client.distribute(&project_id);

    let info = client.get_claimable(&project_id, &alice);
    assert_eq!(info.claimed, 150_0000000i128); // 50% of (200+100)
    assert_eq!(info.distribution_round, 2);
}

#[test]
fn test_get_claimable_fails_for_missing_project() {
    let (env, _admin, _token) = create_test_env();
    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);

    let random = Address::generate(&env);
    let result = client.try_get_claimable(&Symbol::new(&env, "ghost"), &random);
    assert_eq!(result, Err(Ok(SplitError::NotFound)));
}

// ============================================================
//  ISSUE #55 — update_project_metadata TESTS
// ============================================================

#[test]
fn test_update_project_metadata_success() {
    let (env, _admin, token) = create_test_env();
    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let collabs = make_collaborators(
        &env,
        Vec::from_slice(&env, &[alice, bob]),
        Vec::from_slice(&env, &[5000u32, 5000u32]),
    );

    let project_id = Symbol::new(&env, "meta_update");
    client.create_project(
        &owner,
        &project_id,
        &String::from_str(&env, "Original Title"),
        &String::from_str(&env, "music"),
        &token,
        &collabs,
    );

    client.update_project_metadata(
        &project_id,
        &owner,
        &String::from_str(&env, "Updated Title"),
        &String::from_str(&env, "film"),
    );

    let project = client.get_project(&project_id).unwrap();
    assert_eq!(project.title, String::from_str(&env, "Updated Title"));
    assert_eq!(project.project_type, String::from_str(&env, "film"));
}

#[test]
fn test_update_project_metadata_fails_when_locked() {
    let (env, _admin, token) = create_test_env();
    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let collabs = make_collaborators(
        &env,
        Vec::from_slice(&env, &[alice, bob]),
        Vec::from_slice(&env, &[5000u32, 5000u32]),
    );

    let project_id = Symbol::new(&env, "meta_locked");
    client.create_project(
        &owner,
        &project_id,
        &String::from_str(&env, "Locked Title"),
        &String::from_str(&env, "music"),
        &token,
        &collabs,
    );
    client.lock_project(&project_id, &owner);

    let result = client.try_update_project_metadata(
        &project_id,
        &owner,
        &String::from_str(&env, "New Title"),
        &String::from_str(&env, "art"),
    );
    assert_eq!(result, Err(Ok(SplitError::ProjectLocked)));
}

#[test]
fn test_update_project_metadata_fails_when_unauthorized() {
    let (env, _admin, token) = create_test_env();
    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let not_owner = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let collabs = make_collaborators(
        &env,
        Vec::from_slice(&env, &[alice, bob]),
        Vec::from_slice(&env, &[5000u32, 5000u32]),
    );

    let project_id = Symbol::new(&env, "meta_unauth");
    client.create_project(
        &owner,
        &project_id,
        &String::from_str(&env, "Owner Title"),
        &String::from_str(&env, "music"),
        &token,
        &collabs,
    );

    let result = client.try_update_project_metadata(
        &project_id,
        &not_owner,
        &String::from_str(&env, "Hacked Title"),
        &String::from_str(&env, "art"),
    );
    assert_eq!(result, Err(Ok(SplitError::Unauthorized)));
}

#[test]
fn test_update_project_metadata_emits_event() {
    let (env, _admin, token) = create_test_env();
    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let collabs = make_collaborators(
        &env,
        Vec::from_slice(&env, &[alice, bob]),
        Vec::from_slice(&env, &[5000u32, 5000u32]),
    );

    let project_id = Symbol::new(&env, "meta_event");
    client.create_project(
        &owner,
        &project_id,
        &String::from_str(&env, "Event Title"),
        &String::from_str(&env, "music"),
        &token,
        &collabs,
    );

    let events_before = env.events().all().len();
    client.update_project_metadata(
        &project_id,
        &owner,
        &String::from_str(&env, "New Event Title"),
        &String::from_str(&env, "podcast"),
    );

    // At least one new event (metadata_updated) was emitted
    assert!(env.events().all().len() > events_before);
}
