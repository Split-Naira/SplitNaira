#![cfg(test)]

//! Reliability tests: verify contract behaves correctly under edge-case inputs
//! and that error paths return the expected error codes.

use soroban_sdk::{testutils::Address as _, vec, Address, Env, String, Symbol, Vec};

use crate::{
    Collaborator, SplitNairaContract, SplitNairaContractClient,
    errors::SplitError,
};

fn make_client(env: &Env) -> (SplitNairaContractClient, Address) {
    let contract_id = env.register_contract(None, SplitNairaContract);
    let client = SplitNairaContractClient::new(env, &contract_id);
    (client, contract_id)
}

fn two_collabs(env: &Env) -> Vec<Collaborator> {
    let a = Address::generate(env);
    let b = Address::generate(env);
    vec![
        env,
        Collaborator { address: a, alias: String::from_str(env, "A"), basis_points: 5000 },
        Collaborator { address: b, alias: String::from_str(env, "B"), basis_points: 5000 },
    ]
}

/// Distributing to a non-existent project returns NotFound.
#[test]
fn test_distribute_missing_project_returns_not_found() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = make_client(&env);
    let result = client.try_distribute(&Symbol::new(&env, "ghost"));
    assert_eq!(result, Err(Ok(SplitError::NotFound)));
}

/// get_balance on a non-existent project returns NotFound.
#[test]
fn test_get_balance_missing_project_returns_not_found() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = make_client(&env);
    let result = client.try_get_balance(&Symbol::new(&env, "ghost"));
    assert_eq!(result, Err(Ok(SplitError::NotFound)));
}

/// Creating a project with zero basis points for a collaborator returns ZeroShare.
#[test]
fn test_create_project_zero_basis_points_returns_zero_share() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = make_client(&env);
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract(token_admin);
    let owner = Address::generate(&env);
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let collabs = vec![
        &env,
        Collaborator { address: a, alias: String::from_str(&env, "A"), basis_points: 0 },
        Collaborator { address: b, alias: String::from_str(&env, "B"), basis_points: 10000 },
    ];
    let result = client.try_create_project(
        &owner,
        &Symbol::new(&env, "zero_bp"),
        &String::from_str(&env, "Zero BP"),
        &String::from_str(&env, "music"),
        &token,
        &collabs,
    );
    assert_eq!(result, Err(Ok(SplitError::ZeroShare)));
}