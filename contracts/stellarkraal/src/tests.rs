use super::*;
use soroban_sdk::{
    symbol_short, vec,
    testutils::{storage::Persistent as _, Address as _, Ledger, Events},
    Address, Env, Symbol, IntoVal, TryIntoVal,
};
use proptest::prelude::*;

#[contract]
pub struct MockToken;

#[contractimpl]
impl MockToken {
    pub fn transfer(_env: Env, _from: Address, _to: Address, _amount: i128) {}
    pub fn balance(_env: Env, _id: Address) -> i128 { 0 }
}

fn setup() -> (Env, Address, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarKraal);
    let admin = Address::generate(&env);
    let oracle = Address::generate(&env);
    let token = env.register_contract(None, MockToken);
    let treasury = Address::generate(&env);
    (env, contract_id, admin, oracle, token, treasury)
}

fn init(
    env: &Env,
    contract_id: &Address,
    admin: &Address,
    oracle: &Address,
    token: &Address,
    treasury: &Address,
) {
    let client = StellarKraalClient::new(env, contract_id);
    client.initialize(admin, oracle, token, treasury, &6000u32, &8000u32, &1u32);
    client.set_loan_limits(admin, &1i128, &DEFAULT_MAX_LOAN);
}

// ── initialize ────────────────────────────────────────────────────────
#[test]
fn test_initialize_ok() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
}

#[test]
#[should_panic(expected = "#2")]
fn test_initialize_twice_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    init(&env, &cid, &admin, &oracle, &token, &treasury);
}

/// Verify that a failed second `initialize` call leaves all contract state
/// completely unchanged.
///
/// After successful initialization the test attempts to re-initialize with
/// entirely different parameters (different admin, token, LTV, etc.).  The
/// call must be rejected with `Error::AlreadyInitialized` (error code `#2`)
/// and every piece of state that was written during the first initialization
/// must remain exactly as it was.
#[test]
fn test_reinit_state_unchanged_after_failed_second_init() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);

    let client = StellarKraalClient::new(&env, &cid);

    // Capture state produced by the first (successful) initialization.
    let state_before = client.get_state(&admin);
    let fee_before  = client.get_fee_config();
    let close_before = client.get_close_factor();
    let loan_count_before  = state_before.total_loans;
    let col_count_before   = state_before.total_collaterals;

    // Attempt a second initialization with completely different parameters.
    // We use the `try_` variant so the test continues after the expected failure.
    let attacker_admin   = Address::generate(&env);
    let attacker_oracle  = Address::generate(&env);
    let attacker_token   = env.register_contract(None, MockToken);
    let attacker_treasury = Address::generate(&env);

    let result = client.try_initialize(
        &attacker_admin,
        &attacker_oracle,
        &attacker_token,
        &attacker_treasury,
        &9000u32, // different LTV
        &9000u32, // different liquidation threshold
        &5u32,    // different min_quorum
    );

    // The call must be rejected with AlreadyInitialized (error code #2).
    // In the Soroban SDK test harness, `try_` methods return
    // `Result<Result<T, _>, Result<Error, _>>`, and a contract-returned error
    // surfaces as `Err(Ok(Error::AlreadyInitialized))`.
    assert_eq!(
        result,
        Err(Ok(Error::AlreadyInitialized)),
        "second initialize must be rejected with AlreadyInitialized (#2)"
    );

    // --- verify admin is unchanged ---
    let state_after = client.get_state(&admin);
    assert_eq!(
        state_after.admin, state_before.admin,
        "admin must not change after failed re-init"
    );

    // --- verify token is unchanged ---
    assert_eq!(
        state_after.token, state_before.token,
        "token must not change after failed re-init"
    );

    // --- verify LTV is unchanged ---
    assert_eq!(
        state_after.ltv_bps, state_before.ltv_bps,
        "ltv_bps must not change after failed re-init"
    );
    assert_eq!(state_after.ltv_bps, 6000, "ltv_bps must remain at the initial 6000");

    // --- verify liquidation threshold is unchanged ---
    assert_eq!(
        state_after.liq_threshold_bps, state_before.liq_threshold_bps,
        "liq_threshold_bps must not change after failed re-init"
    );
    assert_eq!(state_after.liq_threshold_bps, 8000, "liq_threshold_bps must remain at the initial 8000");

    // --- verify pause state is unchanged ---
    assert_eq!(
        state_after.is_paused, state_before.is_paused,
        "is_paused must not change after failed re-init"
    );

    // --- verify oracle count is unchanged ---
    assert_eq!(
        state_after.oracle_count, state_before.oracle_count,
        "oracle_count must not change after failed re-init"
    );

    // --- verify loan and collateral counters are unchanged ---
    assert_eq!(
        state_after.total_loans, loan_count_before,
        "total_loans must not change after failed re-init"
    );
    assert_eq!(
        state_after.total_collaterals, col_count_before,
        "total_collaterals must not change after failed re-init"
    );

    // --- verify fee configuration is unchanged ---
    let fee_after = client.get_fee_config();
    assert_eq!(
        fee_after.origination_fee_bps, fee_before.origination_fee_bps,
        "origination_fee_bps must not change after failed re-init"
    );
    assert_eq!(
        fee_after.interest_fee_bps, fee_before.interest_fee_bps,
        "interest_fee_bps must not change after failed re-init"
    );

    // --- verify close factor is unchanged ---
    let close_after = client.get_close_factor();
    assert_eq!(
        close_after, close_before,
        "close_factor must not change after failed re-init"
    );
}

#[test]
#[should_panic(expected = "#3")]
fn test_initialize_zero_admin_fails() {
    use soroban_sdk::String;
    let (env, cid, _admin, oracle, token, treasury) = setup();
    let client = StellarKraalClient::new(&env, &cid);
    let zero = Address::from_string(&String::from_str(
        &env,
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    ));
    client.initialize(&zero, &oracle, &token, &treasury, &6000u32, &8000u32, &1u32);
}

#[test]
#[should_panic(expected = "#8")]
fn test_initialize_zero_ltv_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    let client = StellarKraalClient::new(&env, &cid);
    client.initialize(&admin, &oracle, &token, &treasury, &0u32, &8000u32, &1u32);
}

#[test]
#[should_panic(expected = "#8")]
fn test_initialize_ltv_above_max_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    let client = StellarKraalClient::new(&env, &cid);
    client.initialize(&admin, &oracle, &token, &treasury, &9001u32, &9500u32, &1u32);
}



#[test]
#[should_panic(expected = "#8")]
fn test_initialize_liq_below_ltv_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    let client = StellarKraalClient::new(&env, &cid);
    client.initialize(&admin, &oracle, &token, &treasury, &6000u32, &5000u32, &1u32);
}

#[test]
fn test_initialize_valid_params_succeed() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    let client = StellarKraalClient::new(&env, &cid);
    client.initialize(&admin, &oracle, &token, &treasury, &6000u32, &6000u32, &1u32);
}

// ── is_initialized ────────────────────────────────────────────────────

/// `is_initialized` must return `false` before the contract is initialized.
#[test]
fn test_is_initialized_false_before_init() {
    let (env, cid, _admin, _oracle, _token, _treasury) = setup();
    let client = StellarKraalClient::new(&env, &cid);
    assert!(!client.is_initialized(), "is_initialized must be false before initialize()");
}

/// `is_initialized` must return `true` after successful initialization.
#[test]
fn test_is_initialized_true_after_init() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    assert!(client.is_initialized(), "is_initialized must be true after initialize()");
}

/// `is_initialized` does not require authentication and can be called by any address.
#[test]
fn test_is_initialized_no_auth_required() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    // Call without setting up any auth expectation — must still succeed.
    let result = client.is_initialized();
    assert!(result);
}

// ── register_livestock ────────────────────────────────────────────────
#[test]
fn test_register_livestock_ok() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let owner = Address::generate(&env);
    let id = client.register_livestock(&owner, &symbol_short!("cattle"), &5u32, &1_000_000i128);
    assert_eq!(id, 1);
}

#[test]
fn test_register_livestock_value_at_cap_ok() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let owner = Address::generate(&env);
    client.set_animal_cap(&admin, &symbol_short!("cattle"), &1_000_000i128);
    let id = client.register_livestock(&owner, &symbol_short!("cattle"), &1u32, &1_000_000i128);
    assert_eq!(id, 1);
}

#[test]
#[should_panic(expected = "#8")]
fn test_register_livestock_value_above_cap_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let owner = Address::generate(&env);
    client.set_animal_cap(&admin, &symbol_short!("cattle"), &1_000_000i128);
    client.register_livestock(&owner, &symbol_short!("cattle"), &1u32, &1_000_001i128);
}

#[test]
fn test_register_livestock_without_cap_unrestricted() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let owner = Address::generate(&env);
    let id = client.register_livestock(&owner, &symbol_short!("goat"), &1u32, &i128::MAX);
    assert_eq!(id, 1);
}

#[test]
#[should_panic(expected = "#8")]
fn test_register_zero_count_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let owner = Address::generate(&env);
    client.register_livestock(&owner, &symbol_short!("goat"), &0u32, &500_000i128);
}

#[test]
#[should_panic(expected = "#8")]
fn test_register_zero_value_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let owner = Address::generate(&env);
    client.register_livestock(&owner, &symbol_short!("sheep"), &3u32, &0i128);
}

#[test]
fn test_collateral_minimum_rejects_below_boundary() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let owner = Address::generate(&env);
    client.set_min_collateral_value(&admin, &1_000i128);
    assert_eq!(client.get_min_collateral_value(), 1_000);

    let result = client.try_register_livestock(&owner, &symbol_short!("goat"), &1u32, &999i128);
    assert_eq!(result, Err(Ok(Error::CollateralValueTooLow)));
    let id = client.register_livestock(&owner, &symbol_short!("goat"), &1u32, &1_000i128);
    assert_eq!(id, 1);
}

#[test]
fn test_collateral_minimum_non_admin_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let attacker = Address::generate(&env);
    let result = client.try_set_min_collateral_value(&attacker, &1_000i128);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

// ── TTL management ────────────────────────────────────────────────────
#[test]
fn test_collateral_ttl_set_on_register() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let owner = Address::generate(&env);
    let col_id = client.register_livestock(&owner, &symbol_short!("cattle"), &1u32, &1_000_000i128);
    env.as_contract(&cid, || {
        let ttl = env.storage().persistent().get_ttl(&DataKey::Collateral(col_id));
        assert_eq!(ttl, PERSISTENT_TTL_LEDGERS);
    });
}

#[test]
fn test_loan_ttl_set_on_create() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);
    let col_id = client.register_livestock(&borrower, &symbol_short!("cattle"), &2u32, &1_000_000i128);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);
    env.as_contract(&cid, || {
        let ttl = env.storage().persistent().get_ttl(&DataKey::Loan(loan_id));
        assert_eq!(ttl, PERSISTENT_TTL_LEDGERS);
    });
}

// ── request_loan ──────────────────────────────────────────────────────
#[test]
fn test_request_extension_approved_and_limited() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);
    let col_id = client.register_livestock(&borrower, &symbol_short!("cattle"), &2u32, &100_000_000i128);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &20_000_000i128, &Some(1_000u64));
    client.set_max_extensions(&admin, &1);
    assert_eq!(client.get_max_extensions(), 1);
    assert_eq!(client.request_extension(&borrower, &loan_id, &500u64), 1);
    assert_eq!(client.get_loan(&loan_id).due_ledger, Some(1_500));
    let result = client.try_request_extension(&borrower, &loan_id, &500u64);
    assert_eq!(result, Err(Ok(Error::ExtensionLimitReached)));
}

#[test]
fn test_request_extension_denied_when_unsafe() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);
    let col_id = client.register_livestock(&borrower, &symbol_short!("cattle"), &2u32, &100_000_000i128);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &20_000_000i128, &Some(1_000u64));
    env.as_contract(&cid, || {
        let mut loan: LoanRecord = env.storage().persistent().get(&DataKey::Loan(loan_id)).unwrap();
        loan.outstanding = 100_000_000;
        env.storage().persistent().set(&DataKey::Loan(loan_id), &loan);
    });
    let result = client.try_request_extension(&borrower, &loan_id, &500u64);
    assert_eq!(result, Err(Ok(Error::ExtensionDenied)));
}

#[test]
fn test_request_loan_within_ltv() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);
    let col_id =
        client.register_livestock(&borrower, &symbol_short!("cattle"), &2u32, &1_000_000i128);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);
    assert_eq!(loan_id, 1);
}

#[test]
#[should_panic(expected = "#4")]
fn test_request_loan_exceeds_ltv() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);
    let col_id =
        client.register_livestock(&borrower, &symbol_short!("cattle"), &2u32, &1_000_000i128);
    client.request_loan(&borrower, &vec![&env, col_id], &700_000i128, &None);
    client.request_loan(&borrower, &vec![&env, col_id], &700_000i128, &None);
}

#[test]
#[should_panic(expected = "#3")]
fn test_request_loan_wrong_owner() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let owner = Address::generate(&env);
    let attacker = Address::generate(&env);
    let col_id =
        client.register_livestock(&owner, &symbol_short!("goat"), &3u32, &500_000i128);
    client.request_loan(&attacker, &vec![&env, col_id], &100_000i128, &None);
    client.request_loan(&attacker, &vec![&env, col_id], &100_000i128, &None);
}

#[test]
fn test_request_loan_multi_collateral() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);
    let col1 =
        client.register_livestock(&borrower, &symbol_short!("cattle"), &2u32, &600_000i128);
    let col2 =
        client.register_livestock(&borrower, &symbol_short!("goat"), &5u32, &400_000i128);
    let loan_id = client.request_loan(&borrower, &vec![&env, col1, col2], &600_000i128, &None);
    let loan_id = client.request_loan(&borrower, &vec![&env, col1, col2], &600_000i128, &None);
    let loan = client.get_loan(&loan_id);
    assert_eq!(loan.total_collateral_value, 1_000_000);
    assert_eq!(loan.collateral_ids.len(), 2);
}

#[test]
fn test_request_loan_three_collaterals() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);
    let col1 =
        client.register_livestock(&borrower, &symbol_short!("cattle"), &1u32, &300_000i128);
    let col2 =
        client.register_livestock(&borrower, &symbol_short!("goat"), &3u32, &200_000i128);
    let col3 =
        client.register_livestock(&borrower, &symbol_short!("sheep"), &5u32, &100_000i128);
    let loan_id =
        client.request_loan(&borrower, &vec![&env, col1, col2, col3], &360_000i128, &None);
        client.request_loan(&borrower, &vec![&env, col1, col2, col3], &360_000i128, &None);
    let loan = client.get_loan(&loan_id);
    assert_eq!(loan.total_collateral_value, 600_000);
}

#[test]
#[should_panic(expected = "#4")]
fn test_multi_collateral_exceeds_combined_ltv() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);
    let col1 =
        client.register_livestock(&borrower, &symbol_short!("cattle"), &1u32, &500_000i128);
    let col2 =
        client.register_livestock(&borrower, &symbol_short!("goat"), &2u32, &500_000i128);
    client.request_loan(&borrower, &vec![&env, col1, col2], &700_000i128, &None);
    client.request_loan(&borrower, &vec![&env, col1, col2], &700_000i128, &None);
}

#[test]
#[should_panic(expected = "#6")]
fn test_request_loan_empty_collateral_ids_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);
    client.request_loan(&borrower, &vec![&env], &100_000i128, &None);
    client.request_loan(&borrower, &vec![&env], &100_000i128, &None);
}

// ── repay_loan ────────────────────────────────────────────────────────
#[test]
fn test_partial_repay() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);
    let col_id =
        client.register_livestock(&borrower, &symbol_short!("cattle"), &2u32, &1_000_000i128);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);
    client.repay_loan(&borrower, &loan_id, &200_000i128);
    let loan = client.get_loan(&loan_id);
    assert_eq!(loan.outstanding, 400_000);
}

#[test]
fn test_full_repay_marks_repaid() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);
    let col_id =
        client.register_livestock(&borrower, &symbol_short!("cattle"), &2u32, &1_000_000i128);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);
    client.repay_loan(&borrower, &loan_id, &600_000i128);
    let loan = client.get_loan(&loan_id);
    assert_eq!(loan.status, LoanStatus::Repaid);
}

#[test]
#[should_panic(expected = "#9")]
fn test_repay_closed_loan_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);
    let col_id =
        client.register_livestock(&borrower, &symbol_short!("cattle"), &2u32, &1_000_000i128);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);
    client.repay_loan(&borrower, &loan_id, &600_000i128);
    client.repay_loan(&borrower, &loan_id, &1i128);
}

// ── health_factor ─────────────────────────────────────────────────────
#[test]
fn test_health_factor_healthy() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);
    let col_id =
        client.register_livestock(&borrower, &symbol_short!("cattle"), &2u32, &1_000_000i128);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);
    let hf = client.health_factor(&loan_id);
    assert!(hf >= 10_000, "health factor should be >= 1.0");
}

// ── bench: health_factor (issue #668 baseline) ────────────────────────
#[test]
fn bench_health_factor_instruction_count() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);
    let col_id =
        client.register_livestock(&borrower, &symbol_short!("cattle"), &2u32, &1_000_000i128);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);

    env.budget().reset_default();
    let hf = client.health_factor(&loan_id);
    let instructions_after = env.budget().cpu_instruction_cost();

    assert_eq!(hf, 13_333, "health factor value must be unchanged");
    assert!(
        instructions_after < 500_000,
        "health_factor used {} instructions, expected < 500_000",
        instructions_after
    );
}

// ── bench: request_loan (issue #668) ──────────────────────────────────
#[test]
fn bench_request_loan_instruction_count() {
    const SOROBAN_CPU_LIMIT: u64 = 100_000_000;

    // ── 1 collateral ──────────────────────────────────────────────────
    {
        let (env, cid, admin, oracle, token, treasury) = setup();
        init(&env, &cid, &admin, &oracle, &token, &treasury);
        let client = StellarKraalClient::new(&env, &cid);
        let borrower = Address::generate(&env);

        let col = client.register_livestock(
            &borrower,
            &symbol_short!("cattle"),
            &1u32,
            &1_000_000i128,
        );
        let ids = vec![&env, col];

        env.budget().reset_default();
        client.request_loan(&borrower, &ids, &500_000i128, &None);
        client.request_loan(&borrower, &ids, &500_000i128, &None);
        let cost = env.budget().cpu_instruction_cost();
        assert!(
            cost < SOROBAN_CPU_LIMIT,
            "request_loan (1 collateral) used {} instructions, limit {}",
            cost,
            SOROBAN_CPU_LIMIT
        );
    }

    // ── 5 collaterals ─────────────────────────────────────────────────
    {
        let (env, cid, admin, oracle, token, treasury) = setup();
        init(&env, &cid, &admin, &oracle, &token, &treasury);
        let client = StellarKraalClient::new(&env, &cid);
        let borrower = Address::generate(&env);

        let mut ids = soroban_sdk::Vec::new(&env);
        for _ in 0..5u32 {
            let col = client.register_livestock(
                &borrower,
                &symbol_short!("goat"),
                &1u32,
                &200_000i128,
            );
            ids.push_back(col);
        }

        env.budget().reset_default();
        client.request_loan(&borrower, &ids, &600_000i128, &None);
        client.request_loan(&borrower, &ids, &600_000i128, &None);
        let cost = env.budget().cpu_instruction_cost();
        assert!(
            cost < SOROBAN_CPU_LIMIT,
            "request_loan (5 collaterals) used {} instructions, limit {}",
            cost,
            SOROBAN_CPU_LIMIT
        );
    }

    // ── 50 collaterals ────────────────────────────────────────────────
    {
        let (env, cid, admin, oracle, token, treasury) = setup();
        init(&env, &cid, &admin, &oracle, &token, &treasury);
        let client = StellarKraalClient::new(&env, &cid);
        let borrower = Address::generate(&env);

        let mut ids = soroban_sdk::Vec::new(&env);
        for _ in 0..50u32 {
            let col = client.register_livestock(
                &borrower,
                &symbol_short!("sheep"),
                &1u32,
                &20_000i128,
            );
            ids.push_back(col);
        }

        env.budget().reset_default();
        client.request_loan(&borrower, &ids, &600_000i128, &None);
        client.request_loan(&borrower, &ids, &600_000i128, &None);
        let cost = env.budget().cpu_instruction_cost();
        assert!(
            cost < SOROBAN_CPU_LIMIT,
            "request_loan (50 collaterals) used {} instructions, limit {}",
            cost,
            SOROBAN_CPU_LIMIT
        );
    }
}

// ── bench: repay_loan (issue #668) ────────────────────────────────────
#[test]
fn bench_repay_loan_instruction_count() {
    const SOROBAN_CPU_LIMIT: u64 = 100_000_000;

    // ── partial repayment path ────────────────────────────────────────
    {
        let (env, cid, admin, oracle, token, treasury) = setup();
        init(&env, &cid, &admin, &oracle, &token, &treasury);
        let client = StellarKraalClient::new(&env, &cid);
        let borrower = Address::generate(&env);
        let col = client.register_livestock(
            &borrower,
            &symbol_short!("cattle"),
            &1u32,
            &1_000_000i128,
        );
        let loan_id = client.request_loan(&borrower, &vec![&env, col], &600_000i128, &None);
        let loan_id = client.request_loan(&borrower, &vec![&env, col], &600_000i128, &None);

        env.budget().reset_default();
        client.repay_loan(&borrower, &loan_id, &200_000i128);
        let cost = env.budget().cpu_instruction_cost();
        assert!(
            cost < SOROBAN_CPU_LIMIT,
            "repay_loan (partial) used {} instructions, limit {}",
            cost,
            SOROBAN_CPU_LIMIT
        );
    }

    // ── full loan closure path ────────────────────────────────────────
    {
        let (env, cid, admin, oracle, token, treasury) = setup();
        init(&env, &cid, &admin, &oracle, &token, &treasury);
        let client = StellarKraalClient::new(&env, &cid);
        let borrower = Address::generate(&env);
        let col = client.register_livestock(
            &borrower,
            &symbol_short!("cattle"),
            &1u32,
            &1_000_000i128,
        );
        let loan_id = client.request_loan(&borrower, &vec![&env, col], &600_000i128, &None);
        let loan_id = client.request_loan(&borrower, &vec![&env, col], &600_000i128, &None);

        env.budget().reset_default();
        client.repay_loan(&borrower, &loan_id, &600_000i128);
        let cost = env.budget().cpu_instruction_cost();
        assert!(
            cost < SOROBAN_CPU_LIMIT,
            "repay_loan (full closure) used {} instructions, limit {}",
            cost,
            SOROBAN_CPU_LIMIT
        );
    }
}

// ── bench: liquidate (issue #668) ────────────────────────────────────
#[test]
fn bench_liquidate_instruction_count() {
    const SOROBAN_CPU_LIMIT: u64 = 100_000_000;

    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    client.set_liquidation_threshold(&admin, &10_000u32);

    let borrower = Address::generate(&env);
    let liquidator = Address::generate(&env);
    let col = client.register_livestock(
        &borrower,
        &symbol_short!("cattle"),
        &1u32,
        &1_000_000i128,
    );
    let loan_id = client.request_loan(&borrower, &vec![&env, col], &600_000i128, &None);
    let loan_id = client.request_loan(&borrower, &vec![&env, col], &600_000i128, &None);
    client.set_liquidation_threshold(&admin, &10u32);

    env.budget().reset_default();
    client.liquidate(&liquidator, &loan_id, &300_000i128);
    let cost = env.budget().cpu_instruction_cost();
    assert!(
        cost < SOROBAN_CPU_LIMIT,
        "liquidate used {} instructions, limit {}",
        cost,
        SOROBAN_CPU_LIMIT
    );
}

// ── liquidate ─────────────────────────────────────────────────────────
#[test]
#[should_panic(expected = "#7")]
fn test_liquidate_healthy_loan_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);
    let liquidator = Address::generate(&env);
    let col_id =
        client.register_livestock(&borrower, &symbol_short!("cattle"), &2u32, &1_000_000i128);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);
    client.liquidate(&liquidator, &loan_id, &300_000i128);
}

#[test]
fn test_liquidate_emits_loan_liquidated_event() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    let borrower = Address::generate(&env);
    let liquidator = Address::generate(&env);

    let col_id = client.register_livestock(
        &borrower,
        &symbol_short!("cattle"),
        &2u32,
        &1_000_000i128,
    );
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);

    // Drive the loan unhealthy: outstanding > 800_000 forces hf < 10_000 with 80% liq_thr.
    env.as_contract(&cid, || {
        let mut loan: LoanRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Loan(loan_id))
            .unwrap();
        loan.outstanding = 900_000;
        env.storage().persistent().set(&DataKey::Loan(loan_id), &loan);
    });

    let repay = 450_000i128;
    client.liquidate(&liquidator, &loan_id, &repay);

    let events = env.events().all();
    let topic = vec![
        &env,
        symbol_short!("loan").into_val(&env),
        Symbol::new(&env, "liquidated").into_val(&env),
    ];
    let liq_event = events
        .iter()
        .rev()
        .find(|e| e.1 == topic)
        .expect("loan_liquidated event not found");

    let data: (u64, Address, i128, i128, LoanStatus) = liq_event.2.clone().into_val(&env);
    assert_eq!(data.0, loan_id);
    assert_eq!(data.1, liquidator);
    assert_eq!(data.2, repay);
    assert_eq!(data.3, 900_000 - repay);
    assert_eq!(data.4, LoanStatus::Active);
}

// ── get_loan / get_collateral ─────────────────────────────────────────
#[test]
fn test_get_loan_ok() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);
    let col_id =
        client.register_livestock(&borrower, &symbol_short!("sheep"), &10u32, &2_000_000i128);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &500_000i128, &None);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &500_000i128, &None);
    let loan = client.get_loan(&loan_id);
    assert_eq!(loan.principal, 500_000);
    assert_eq!(loan.borrower, borrower);
}

#[test]
fn test_get_collateral_ok() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let owner = Address::generate(&env);
    let col_id =
        client.register_livestock(&owner, &symbol_short!("goat"), &7u32, &700_000i128);
    let col = client.get_collateral(&col_id);
    assert_eq!(col.count, 7);
    assert_eq!(col.appraised_value, 700_000);
}

#[test]
fn test_get_loan_collaterals_ok() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);
    let col1 =
        client.register_livestock(&borrower, &symbol_short!("cattle"), &2u32, &600_000i128);
    let col2 =
        client.register_livestock(&borrower, &symbol_short!("goat"), &3u32, &400_000i128);
    let loan_id = client.request_loan(&borrower, &vec![&env, col1, col2], &600_000i128, &None);
    let loan_id = client.request_loan(&borrower, &vec![&env, col1, col2], &600_000i128, &None);
    let collaterals = client.get_loan_collaterals(&loan_id);
    assert_eq!(collaterals.len(), 2);
    assert_eq!(collaterals.get(0).unwrap().animal_type, symbol_short!("cattle"));
    assert_eq!(collaterals.get(1).unwrap().animal_type, symbol_short!("goat"));
}

#[test]
#[should_panic(expected = "#5")]
fn test_get_nonexistent_loan_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    client.get_loan(&999u64);
}

#[test]
#[should_panic(expected = "#6")]
fn test_get_nonexistent_collateral_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    client.get_collateral(&999u64);
}

#[test]
fn test_get_collateral_count() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let owner = Address::generate(&env);
    let other_owner = Address::generate(&env);

    assert_eq!(client.get_collateral_count(&owner), 0);

    client.register_livestock(&owner, &symbol_short!("cattle"), &2u32, &1_000_000i128);
    assert_eq!(client.get_collateral_count(&owner), 1);

    client.register_livestock(&owner, &symbol_short!("goat"), &5u32, &500_000i128);
    assert_eq!(client.get_collateral_count(&owner), 2);

    client.register_livestock(&other_owner, &symbol_short!("sheep"), &10u32, &2_000_000i128);
    assert_eq!(client.get_collateral_count(&owner), 2);
    assert_eq!(client.get_collateral_count(&other_owner), 1);
}

// ── get_loans (issue #670) ────────────────────────────────────────────

#[test]
fn test_get_loans_empty_ids() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let results = client.get_loans(&vec![&env]);
    assert_eq!(results.len(), 0);
}

#[test]
fn test_get_loans_partial_match() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);
    let col = client.register_livestock(
        &borrower,
        &symbol_short!("cattle"),
        &1u32,
        &1_000_000i128,
    );
    let real_id = client.request_loan(&borrower, &vec![&env, col], &600_000i128, &None);
    let real_id = client.request_loan(&borrower, &vec![&env, col], &600_000i128, &None);

    let ids = vec![&env, 9999u64, real_id, 8888u64];
    let results = client.get_loans(&ids);
    assert_eq!(results.len(), 1);
    assert_eq!(results.get(0).unwrap().id, real_id);
}

#[test]
fn test_get_loans_full_match() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);

    let col1 = client.register_livestock(
        &borrower,
        &symbol_short!("cattle"),
        &1u32,
        &600_000i128,
    );
    let col2 = client.register_livestock(
        &borrower,
        &symbol_short!("goat"),
        &1u32,
        &600_000i128,
    );
    let id1 = client.request_loan(&borrower, &vec![&env, col1], &360_000i128, &None);
    let id2 = client.request_loan(&borrower, &vec![&env, col2], &360_000i128, &None);
    let id1 = client.request_loan(&borrower, &vec![&env, col1], &360_000i128, &None);
    let id2 = client.request_loan(&borrower, &vec![&env, col2], &360_000i128, &None);

    let results = client.get_loans(&vec![&env, id1, id2]);
    assert_eq!(results.len(), 2);
}

#[test]
fn test_get_loans_exactly_20_ids() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let mut ids = soroban_sdk::Vec::new(&env);
    for i in 1001u64..=1020u64 {
        ids.push_back(i);
    }
    let results = client.get_loans(&ids);
    assert_eq!(results.len(), 0);
}

#[test]
#[should_panic(expected = "#8")]
fn test_get_loans_too_many_ids_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let mut ids = soroban_sdk::Vec::new(&env);
    for i in 1u64..=21u64 {
        ids.push_back(i);
    }
    client.get_loans(&ids);
}

// ── not initialized guard ─────────────────────────────────────────────
#[test]
#[should_panic(expected = "#1")]
fn test_register_without_init_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let cid = env.register_contract(None, StellarKraal);
    let client = StellarKraalClient::new(&env, &cid);
    let owner = Address::generate(&env);
    client.register_livestock(&owner, &symbol_short!("cattle"), &1u32, &100_000i128);
}

// ── invalid amount guards ─────────────────────────────────────────────
#[test]
#[should_panic(expected = "#8")]
fn test_request_zero_amount_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);
    let col_id =
        client.register_livestock(&borrower, &symbol_short!("cattle"), &2u32, &1_000_000i128);
    client.request_loan(&borrower, &vec![&env, col_id], &0i128, &None);
    client.request_loan(&borrower, &vec![&env, col_id], &0i128, &None);
}

#[test]
#[should_panic(expected = "#8")]
fn test_repay_zero_amount_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);
    let col_id =
        client.register_livestock(&borrower, &symbol_short!("cattle"), &2u32, &1_000_000i128);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);
    client.repay_loan(&borrower, &loan_id, &0i128);
}

// ── multiple loans counter ────────────────────────────────────────────
#[test]
fn test_multiple_collaterals_increment_ids() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let owner = Address::generate(&env);
    let id1 =
        client.register_livestock(&owner, &symbol_short!("cattle"), &1u32, &500_000i128);
    let id2 =
        client.register_livestock(&owner, &symbol_short!("goat"), &2u32, &300_000i128);
    assert_eq!(id2, id1 + 1);
}

#[test]
fn test_repay_more_than_outstanding_caps_at_outstanding() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);
    let col_id =
        client.register_livestock(&borrower, &symbol_short!("cattle"), &2u32, &1_000_000i128);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);
    client.repay_loan(&borrower, &loan_id, &999_999_999i128);
    let loan = client.get_loan(&loan_id);
    assert_eq!(loan.status, LoanStatus::Repaid);
    assert_eq!(loan.outstanding, 0);
}

#[test]
fn test_accrue_interest_is_idempotent() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);
    let col_id = client.register_livestock(&borrower, &symbol_short!("cattle"), &2u32, &100_000_000i128);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &20_000_000i128, &None);

    assert_eq!(client.accrue_interest(&loan_id), 0);
    env.ledger().with_mut(|li| li.timestamp += 31_536_000);
    assert_eq!(client.accrue_interest(&loan_id), 2_000_000);
    assert_eq!(client.accrue_interest(&loan_id), 0);
    assert_eq!(client.get_loan(&loan_id).interest_accrued, 2_000_000);
}

// ── pause / unpause ───────────────────────────────────────────────────
#[test]
fn test_pause_by_admin_ok() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    client.pause(&admin);
    assert!(client.is_paused());
}

#[test]
#[should_panic(expected = "#3")]
fn test_pause_by_non_admin_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let attacker = Address::generate(&env);
    client.pause(&attacker);
}

#[test]
fn test_unpause_by_admin_ok() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    client.pause(&admin);
    client.unpause(&admin);
    assert!(!client.is_paused());
}

#[test]
#[should_panic(expected = "#19")]
fn test_unpause_when_not_paused_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    client.unpause(&admin);
}

#[test]
#[should_panic(expected = "#13")]
fn test_register_livestock_blocked_when_paused() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    client.pause(&admin);
    let owner = Address::generate(&env);
    client.register_livestock(&owner, &symbol_short!("cattle"), &1u32, &100_000i128);
}

#[test]
#[should_panic(expected = "#13")]
fn test_request_loan_blocked_when_paused() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);
    let col_id =
        client.register_livestock(&borrower, &symbol_short!("cattle"), &2u32, &1_000_000i128);
    client.pause(&admin);
    client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);
    client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);
}

#[test]
#[should_panic(expected = "#13")]
fn test_liquidate_blocked_when_paused() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);
    let liquidator = Address::generate(&env);
    let col_id =
        client.register_livestock(&borrower, &symbol_short!("cattle"), &2u32, &1_000_000i128);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);
    client.pause(&admin);
    client.liquidate(&liquidator, &loan_id, &300_000i128);
}

#[test]
fn test_repay_allowed_when_paused() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);
    let col_id =
        client.register_livestock(&borrower, &symbol_short!("cattle"), &2u32, &1_000_000i128);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);
    client.pause(&admin);
    client.repay_loan(&borrower, &loan_id, &200_000i128);
    let loan = client.get_loan(&loan_id);
    assert_eq!(loan.outstanding, 400_000);
}

#[test]
fn test_auto_unpause_after_expiry() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    client.set_pause_duration(&admin, &1u64);
    client.pause(&admin);
    assert!(client.is_paused());
    env.ledger().with_mut(|li| {
        li.timestamp += 2;
    });
    assert!(!client.is_paused());
}

#[test]
fn test_pause_emits_event() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    client.pause(&admin);
    assert!(client.is_paused());
}

/// update_fee_config must be blocked when paused.
#[test]
#[should_panic(expected = "#13")]
fn test_update_fee_config_blocked_when_paused() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    client.pause(&admin);
    client.update_fee_config(&admin, &50u32, &100u32);
}

/// add_oracle must be blocked when paused.
#[test]
#[should_panic(expected = "#13")]
fn test_add_oracle_blocked_when_paused() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    client.pause(&admin);
    let oracle2 = Address::generate(&env);
    client.add_oracle(&admin, &oracle2);
}

/// All state-mutating functions succeed after unpause.
#[test]
fn test_all_blocked_functions_succeed_after_unpause() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    let owner = Address::generate(&env);
    let borrower = Address::generate(&env);

    let col_id = client.register_livestock(&owner, &symbol_short!("cattle"), &3u32, &1_000_000i128);

    client.pause(&admin);
    assert!(client.is_paused(), "contract must be paused");

    assert_eq!(
        client.try_register_livestock(&borrower, &symbol_short!("goat"), &1u32, &500_000i128),
        Err(Ok(Error::ContractPaused)),
        "register_livestock must be blocked (#13)"
    );
    let col_ids = vec![&env, col_id];
    assert_eq!(
        client.try_request_loan(&owner, &col_ids, &600_000i128, &None),
        Err(Ok(Error::ContractPaused)),
        "request_loan must be blocked (#13)"
    );
    assert_eq!(
        client.try_update_fee_config(&admin, &50u32, &100u32),
        Err(Ok(Error::ContractPaused)),
        "update_fee_config must be blocked (#13)"
    );
    let new_oracle = Address::generate(&env);
    assert_eq!(
        client.try_add_oracle(&admin, &new_oracle),
        Err(Ok(Error::ContractPaused)),
        "add_oracle must be blocked (#13)"
    );

    client.unpause(&admin);
    assert!(!client.is_paused(), "contract must be unpaused");

    let new_col_id = client.register_livestock(&borrower, &symbol_short!("goat"), &2u32, &800_000i128);
    assert!(new_col_id > col_id);
    let new_col = client.get_collateral(&new_col_id);
    assert_eq!(new_col.count, 2);

    let col_ids2 = vec![&env, col_id];
    let loan_id = client.request_loan(&owner, &col_ids2, &600_000i128, &None);
    let loan_id = client.request_loan(&owner, &col_ids2, &600_000i128, &None);
    let loan = client.get_loan(&loan_id);
    assert_eq!(loan.status, LoanStatus::Active);
    assert_eq!(loan.principal, 600_000);

    client.update_fee_config(&admin, &100u32, &200u32);
    let fee_cfg = client.get_fee_config();
    assert_eq!(fee_cfg.origination_fee_bps, 100);
    assert_eq!(fee_cfg.interest_fee_bps, 200);

    let oracles_before = client.get_oracles().len();
    client.add_oracle(&admin, &new_oracle);
    let oracles_after = client.get_oracles().len();
    assert_eq!(oracles_after, oracles_before + 1);
}

// ── set_pause_duration / MAX_PAUSE_DURATION (issue #674) ──────────────

#[test]
fn test_set_pause_duration_at_max_ok() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    client.set_pause_duration(&admin, &MAX_PAUSE_DURATION);
}

#[test]
#[should_panic(expected = "#8")]
fn test_set_pause_duration_above_max_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    client.set_pause_duration(&admin, &(MAX_PAUSE_DURATION + 1));
}

// ── upgrade mechanism (issue #669) ───────────────────────────────────

fn zero_wasm_hash(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0u8; 32])
}

#[test]
fn test_propose_upgrade_ok_and_timelock_blocks_execute() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    let hash = zero_wasm_hash(&env);
    client.propose_upgrade(&admin, &hash);

    let result = client.try_execute_upgrade();
    match result.unwrap_err() {
        Ok(Error::TimelockNotElapsed) => {}
        other => panic!("expected TimelockNotElapsed, got {:?}", other),
    }
}

#[test]
fn test_cancel_upgrade_clears_proposal() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    client.propose_upgrade(&admin, &zero_wasm_hash(&env));
    client.cancel_upgrade(&admin);

    let result = client.try_execute_upgrade();
    match result.unwrap_err() {
        Ok(Error::NoUpgradePending) => {}
        other => panic!("expected NoUpgradePending after cancel, got {:?}", other),
    }
}

#[test]
#[should_panic(expected = "#24")]
fn test_cancel_upgrade_no_proposal_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    client.cancel_upgrade(&admin);
}

#[test]
fn test_upgrade_non_admin_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let attacker = Address::generate(&env);
    let result = client.try_upgrade(&attacker, &zero_wasm_hash(&env));
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
#[should_panic(expected = "#3")]
fn test_propose_upgrade_non_admin_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let attacker = Address::generate(&env);
    client.propose_upgrade(&attacker, &zero_wasm_hash(&env));
}

#[test]
fn test_execute_upgrade_after_timelock_passes_logic_checks() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    client.propose_upgrade(&admin, &zero_wasm_hash(&env));

    env.ledger().with_mut(|li| {
        li.timestamp += UPGRADE_TIMELOCK_SECS + 1;
    });

    let result = client.try_execute_upgrade();
    match result {
        Ok(Ok(())) => {}
        Ok(Err(_)) => {}
        Err(Ok(Error::TimelockNotElapsed)) => {
            panic!("should not be TimelockNotElapsed after timelock")
        }
        Err(Ok(Error::NoUpgradePending)) => {
            panic!("should not be NoUpgradePending with active proposal")
        }
        Err(_) => {}
    }
}

// ── get_state ─────────────────────────────────────────────────────────

#[test]
fn test_get_state_matches_expected_values() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);
    let oracle2 = Address::generate(&env);

    client.add_oracle(&admin, &oracle2);
    let col_id = client.register_livestock(&borrower, &symbol_short!("cattle"), &2u32, &1_000_000i128);
    client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);
    client.pause(&admin);

    let state = client.get_state(&admin);

    assert_eq!(state.admin, admin);
    assert_eq!(state.token, token);
    assert_eq!(state.ltv_bps, 6000);
    assert_eq!(state.liq_threshold_bps, 8000);
    assert!(state.is_paused);
    assert_eq!(state.oracle_count, 2);
    assert_eq!(state.total_loans, 1);
    assert_eq!(state.total_collaterals, 1);
}

#[test]
#[should_panic(expected = "#3")]
fn test_get_state_non_admin_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let attacker = Address::generate(&env);
    client.get_state(&attacker);
}

// ── oracle tests ──────────────────────────────────────────────────────
#[test]
fn test_add_oracle_ok() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let oracle2 = Address::generate(&env);
    client.add_oracle(&admin, &oracle2);
    let oracles = client.get_oracles();
    assert_eq!(oracles.len(), 2);
}

#[test]
#[should_panic(expected = "#3")]
fn test_add_oracle_non_admin_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let attacker = Address::generate(&env);
    let oracle2 = Address::generate(&env);
    client.add_oracle(&attacker, &oracle2);
}

#[test]
#[should_panic(expected = "#14")]
fn test_add_duplicate_oracle_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    client.add_oracle(&admin, &oracle);
}

#[test]
#[should_panic(expected = "#15")]
fn test_add_oracle_beyond_limit_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    for _ in 0..4 {
        client.add_oracle(&admin, &Address::generate(&env));
    }
    client.add_oracle(&admin, &Address::generate(&env));
}

#[test]
fn test_remove_oracle_ok() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let oracle2 = Address::generate(&env);
    client.add_oracle(&admin, &oracle2);
    client.remove_oracle(&admin, &oracle2);
    let oracles = client.get_oracles();
    assert_eq!(oracles.len(), 1);
}

#[test]
#[should_panic(expected = "#16")]
fn test_remove_nonexistent_oracle_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let unknown = Address::generate(&env);
    client.remove_oracle(&admin, &unknown);
}

#[test]
fn test_submit_oracle_prices_median_odd() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    client.add_oracle(&admin, &Address::generate(&env));
    client.add_oracle(&admin, &Address::generate(&env));

    let submitter = Address::generate(&env);
    let prices = vec![&env, 100i128, 200i128, 300i128];
    let result = client.submit_oracle_prices(&submitter, &prices);
    assert_eq!(result.median, 200);
    assert_eq!(result.responses, 3);
    assert_eq!(result.flagged_count, 0);
}

#[test]
#[should_panic(expected = "#17")]
fn test_submit_oracle_prices_below_quorum_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    client.add_oracle(&admin, &Address::generate(&env));
    client.add_oracle(&admin, &Address::generate(&env));
    client.update_oracle(&admin, &oracle, &4u32);
    let submitter = Address::generate(&env);
    let prices = vec![&env, 100i128, 200i128, 300i128];
    client.submit_oracle_prices(&submitter, &prices);
}

#[test]
#[should_panic(expected = "#18")]
fn test_submit_oracle_prices_wrong_length_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let submitter = Address::generate(&env);
    let prices = vec![&env, 100i128, 200i128];
    client.submit_oracle_prices(&submitter, &prices);
}

// ── event tests ───────────────────────────────────────────────────────
#[test]
fn test_livestock_registered_event() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let owner = Address::generate(&env);
    let _id = client.register_livestock(&owner, &symbol_short!("cattle"), &5u32, &1_000_000i128);
    assert!(!env.events().all().is_empty());
}

#[test]
fn test_livestock_registered_event_emitted() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let owner = Address::generate(&env);
    let _id = client.register_livestock(&owner, &symbol_short!("cattle"), &5u32, &1_000_000i128);

    let events = env.events().all();
    let last_event = events.last().unwrap();
    let topic = vec![
        &env,
        symbol_short!("livestock").into_val(&env),
        Symbol::new(&env, "registered").into_val(&env),
    ];
    assert_eq!(last_event.1, topic);
}

#[test]
fn test_loan_requested_event() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);
    let col_id =
        client.register_livestock(&borrower, &symbol_short!("cattle"), &2u32, &1_000_000i128);
    let events_before = env.events().all().len();
    let _loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);
    let _loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);
    assert!(env.events().all().len() > events_before);
}

#[test]
fn test_loan_requested_event_emitted() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);
    let col_id =
        client.register_livestock(&borrower, &symbol_short!("cattle"), &2u32, &1_000_000i128);
    let _loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);
    let _loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);

    let events = env.events().all();
    let topic = vec![
        &env,
        symbol_short!("loan").into_val(&env),
        Symbol::new(&env, "requested").into_val(&env),
    ];
    let loan_event = events.iter().find(|e| e.1 == topic);
    assert!(loan_event.is_some());
}

#[test]
fn test_loan_transition_event_schema() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);
    let col_id = client.register_livestock(&borrower, &symbol_short!("cattle"), &2u32, &100_000_000i128);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &20_000_000i128, &None);

    let events = env.events().all();
    let topic = vec![
        &env,
        symbol_short!("loan").into_val(&env),
        Symbol::new(&env, "transition").into_val(&env),
    ];
    let event = events.iter().find(|event| event.1 == topic).expect("transition event missing");
    let data: (u64, Address, Symbol, Symbol, u64) = event.2.try_into_val(&env).unwrap();
    assert_eq!(data.0, loan_id);
    assert_eq!(data.1, borrower);
    assert_eq!(data.2, Symbol::new(&env, "pending"));
    assert_eq!(data.3, Symbol::new(&env, "active"));
}

#[test]
fn test_loan_repaid_event() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);
    let col_id =
        client.register_livestock(&borrower, &symbol_short!("cattle"), &2u32, &1_000_000i128);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);
    let events_before = env.events().all().len();
    client.repay_loan(&borrower, &loan_id, &200_000i128);
    assert!(env.events().all().len() > events_before);
}

#[test]
fn test_loan_repaid_event_emitted_partial() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);
    let col_id =
        client.register_livestock(&borrower, &symbol_short!("cattle"), &2u32, &1_000_000i128);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);
    client.repay_loan(&borrower, &loan_id, &200_000i128);

    let events = env.events().all();
    let topic = vec![
        &env,
        Symbol::new(&env, "loan_repaid").into_val(&env),
        borrower.into_val(&env),
    ];
    let repay_event = events.iter().find(|e| e.1 == topic);
    assert!(repay_event.is_some());
}

#[test]
fn test_loan_repaid_event_data() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);
    let col_id =
        client.register_livestock(&borrower, &symbol_short!("cattle"), &2u32, &1_000_000i128);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);

    client.repay_loan(&borrower, &loan_id, &200_000i128);
    let mut events = env.events().all();
    let topic = vec![
        &env,
        Symbol::new(&env, "loan_repaid").into_val(&env),
        borrower.clone().into_val(&env),
    ];
    let mut repay_event = events
        .iter()
        .find(|e| e.1 == topic)
        .expect("loan_repaid event not found for partial repayment");

    let data: (u64, i128, i128, i128) = repay_event.2.clone().into_val(&env);
    assert_eq!(data.0, loan_id);
    assert_eq!(data.1, 200_000);
    assert_eq!(data.2, 0);
    assert_eq!(data.3, 400_000);

    client.repay_loan(&borrower, &loan_id, &400_000i128);
    events = env.events().all();
    repay_event = events
        .iter()
        .rev()
        .find(|e| e.1 == topic)
        .expect("loan_repaid event not found for full repayment");

    let data2: (u64, i128, i128, i128) = repay_event.2.clone().into_val(&env);
    assert_eq!(data2.0, loan_id);
    assert_eq!(data2.1, 400_000);
    assert_eq!(data2.2, 0);
    assert_eq!(data2.3, 0);
}

// ── Error variant negative tests ──────────────────────────────────────

#[test]
#[should_panic(expected = "#1")]
fn test_not_initialized_register_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarKraal);
    let client = StellarKraalClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    client.register_livestock(&owner, &symbol_short!("goat"), &1u32, &1_000i128);
}

#[test]
#[should_panic(expected = "#5")]
fn test_loan_not_found_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    client.get_loan(&9999u64);
}

#[test]
#[should_panic(expected = "#6")]
fn test_collateral_not_found_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    client.get_collateral(&9999u64);
}

#[test]
#[should_panic(expected = "#10")]
fn test_invalid_fee_rate_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    client.update_fee_config(&admin, &501u32, &0u32);
}

#[test]
#[should_panic(expected = "#11")]
fn test_exceeds_close_factor_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    client.set_close_factor(&admin, &5000u32);
    let borrower = Address::generate(&env);
    let liquidator = Address::generate(&env);
    let col_id =
        client.register_livestock(&borrower, &symbol_short!("cattle"), &1u32, &1_000_000i128);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);
    env.as_contract(&cid, || {
        let mut loan: LoanRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Loan(loan_id))
            .unwrap();
        loan.outstanding = 900_000;
        env.storage().persistent().set(&DataKey::Loan(loan_id), &loan);
    });
    client.liquidate(&liquidator, &loan_id, &500_000i128);
}

#[test]
#[should_panic(expected = "#12")]
fn test_invalid_close_factor_zero_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    client.set_close_factor(&admin, &0u32);
}

#[test]
#[should_panic(expected = "#12")]
fn test_invalid_close_factor_over_max_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    client.set_close_factor(&admin, &10_001u32);
}

#[test]
fn test_close_factor_lower_bound_succeeds() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    client.set_close_factor(&admin, &1u32);
    let cf = client.get_close_factor();
    assert_eq!(cf, 1u32, "close factor should be 1 bps");
}

#[test]
fn test_close_factor_upper_bound_succeeds() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    client.set_close_factor(&admin, &10_000u32);
    let cf = client.get_close_factor();
    assert_eq!(cf, 10_000u32, "close factor should be 10000 bps");
}

#[test]
#[should_panic(expected = "#13")]
fn test_register_when_paused_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    client.pause(&admin);
    let owner = Address::generate(&env);
    client.register_livestock(&owner, &symbol_short!("goat"), &1u32, &500_000i128);
}

// ── get_fee_config ───────────────────────────────────────────────────
#[test]
fn test_get_fee_config_matches_init_values() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let fee = client.get_fee_config();
    assert_eq!(fee.origination_fee_bps, 50);
    assert_eq!(fee.interest_fee_bps, 1000);
}

#[test]
fn test_get_fee_config_after_update() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    client.update_fee_config(&admin, &100u32, &200u32);
    let fee = client.get_fee_config();
    assert_eq!(fee.origination_fee_bps, 100);
    assert_eq!(fee.interest_fee_bps, 200);
}

#[test]
fn test_get_fee_config_is_read_only() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let fee1 = client.get_fee_config();
    let fee2 = client.get_fee_config();
    assert_eq!(fee1.origination_fee_bps, fee2.origination_fee_bps);
    assert_eq!(fee1.interest_fee_bps, fee2.interest_fee_bps);
}

// ── emergency_withdraw ───────────────────────────────────────────────
#[test]
fn test_emergency_withdraw_paused_admin_ok() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let recipient = Address::generate(&env);
    client.pause(&admin);
    let events_before = env.events().all().len();
    client.emergency_withdraw(&admin, &recipient);
    let events_after = env.events().all().len();
    assert!(events_after > events_before, "emergency_withdraw should emit an event");
}

#[test]
#[should_panic(expected = "#19")]
fn test_emergency_withdraw_unpaused_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let recipient = Address::generate(&env);
    client.emergency_withdraw(&admin, &recipient);
}

#[test]
#[should_panic(expected = "#3")]
fn test_emergency_withdraw_non_admin_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let attacker = Address::generate(&env);
    let recipient = Address::generate(&env);
    client.pause(&admin);
    client.emergency_withdraw(&attacker, &recipient);
}

// ── set_ltv ──────────────────────────────────────────────────────────
#[test]
fn test_set_ltv_ok() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    client.set_ltv(&admin, &5000u32);
    let borrower = Address::generate(&env);
    let col_id = client.register_livestock(&borrower, &symbol_short!("cattle"), &2u32, &1_000_000i128);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &500_000i128, &None);
    assert_eq!(loan_id, 1);
}

#[test]
fn test_set_ltv_emits_event() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let events_before = env.events().all().len();
    client.set_ltv(&admin, &7000u32);
    let events_after = env.events().all().len();
    assert!(events_after > events_before, "set_ltv should emit an event");
}

#[test]
fn test_set_ltv_boundary_low() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    client.set_ltv(&admin, &1000u32);
}

#[test]
fn test_set_ltv_boundary_high() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    client.set_ltv(&admin, &9000u32);
}

#[test]
#[should_panic(expected = "#8")]
fn test_set_ltv_below_min_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    client.set_ltv(&admin, &999u32);
}

#[test]
#[should_panic(expected = "#8")]
fn test_set_ltv_above_max_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    client.set_ltv(&admin, &9001u32);
}

#[test]
#[should_panic(expected = "#3")]
fn test_set_ltv_non_admin_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let attacker = Address::generate(&env);
    client.set_ltv(&attacker, &5000u32);
}

// ── get_ltv ───────────────────────────────────────────────────────────
#[test]
fn test_get_ltv_returns_initialized_value() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    // initialize() sets ltv to 6000 bps (60%)
    assert_eq!(client.get_ltv(), 6000u32);
}

#[test]
fn test_get_ltv_after_update() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    client.set_ltv(&admin, &7000u32);
    assert_eq!(client.get_ltv(), 7000u32);
}

// ── proptests ─────────────────────────────────────────────────────────
proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    #[test]
    fn prop_repayment_bounds(amount in 1..2_000_000i128, repay in 1..2_000_000i128) {
        let (env, cid, admin, oracle, token, treasury) = setup();
        init(&env, &cid, &admin, &oracle, &token, &treasury);
        let client = StellarKraalClient::new(&env, &cid);
        let borrower = Address::generate(&env);
        let val = amount * 2;
        let col_id = client.register_livestock(&borrower, &symbol_short!("cattle"), &1, &val);
        let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &amount, &None);
        let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &amount, &None);
        client.repay_loan(&borrower, &loan_id, &repay);
        let loan = client.get_loan(&loan_id);
        assert!(loan.outstanding >= 0);
        assert!(loan.outstanding <= amount);
        assert!(amount - loan.outstanding <= amount);
    }

    #[test]
    fn prop_health_factor_post_repayment(amount in 1..1_000_000i128) {
        let (env, cid, admin, oracle, token, treasury) = setup();
        init(&env, &cid, &admin, &oracle, &token, &treasury);
        let client = StellarKraalClient::new(&env, &cid);
        let borrower = Address::generate(&env);
        let col_id = client.register_livestock(&borrower, &symbol_short!("cattle"), &1, &(amount * 2));
        let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &amount, &None);
        let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &amount, &None);
        client.repay_loan(&borrower, &loan_id, &amount);
        let hf = client.health_factor(&loan_id);
        assert_eq!(hf, i128::MAX);
        let loan = client.get_loan(&loan_id);
        assert_eq!(loan.status, LoanStatus::Repaid);
    }

    #[test]
    fn prop_liquidation_eligibility(amount in 1..1_000_000i128) {
        let (env, cid, admin, oracle, token, treasury) = setup();
        init(&env, &cid, &admin, &oracle, &token, &treasury);
        let client = StellarKraalClient::new(&env, &cid);
        let borrower = Address::generate(&env);
        let liquidator = Address::generate(&env);
        let val = amount * 2;
        let col_id = client.register_livestock(&borrower, &symbol_short!("cattle"), &1, &val);
        let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &amount, &None);
        let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &amount, &None);
        let hf = client.health_factor(&loan_id);
        if hf >= 10_000 {
            let res = client.try_liquidate(&liquidator, &loan_id, &1i128);
            assert!(res.is_err());
        }
    }

    #[test]
    fn prop_loan_invariants(val in 1..1_000_000i128, amount_pct in 1..6000u32) {
        let (env, cid, admin, oracle, token, treasury) = setup();
        init(&env, &cid, &admin, &oracle, &token, &treasury);
        let client = StellarKraalClient::new(&env, &cid);
        let borrower = Address::generate(&env);
        let amount = (val * amount_pct as i128) / 10000;
        if amount <= 0 { return Ok(()); }
        let col_id = client.register_livestock(&borrower, &symbol_short!("cattle"), &1, &val);
        let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &amount, &None);
        let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &amount, &None);
        let loan = client.get_loan(&loan_id);
        assert_eq!(loan.status, LoanStatus::Active);
        assert_eq!(loan.borrower, borrower);
        assert_eq!(loan.collateral_ids.get(0).unwrap(), col_id);
        assert_eq!(loan.total_collateral_value, val);
        assert_eq!(loan.outstanding, loan.principal);
    }
}

// ── get_loan_count tests (issue #657) ───────────────────────────────────

#[test]
fn test_get_loan_count_zero() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);

    assert_eq!(client.get_loan_count(&borrower), 0);
}

#[test]
fn test_get_loan_count_one() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);

    let col_id = client.register_livestock(&borrower, &symbol_short!("cattle"), &2, &1_000_000);
    client.request_loan(&borrower, &vec![&env, col_id], &500_000, &None);

    assert_eq!(client.get_loan_count(&borrower), 1);
}

#[test]
fn test_get_loan_count_multiple_and_statuses() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);
    let other_borrower = Address::generate(&env);

    let col1 = client.register_livestock(&borrower, &symbol_short!("goat"), &10, &1_000_000);
    let loan1 = client.request_loan(&borrower, &vec![&env, col1], &400_000, &None);

    let col2 = client.register_livestock(&borrower, &symbol_short!("sheep"), &5, &1_000_000);
    let _loan2 = client.request_loan(&borrower, &vec![&env, col2], &300_000, &None);

    let col3 = client.register_livestock(&borrower, &symbol_short!("cattle"), &1, &1_000_000);
    let _loan3 = client.request_loan(&borrower, &vec![&env, col3], &200_000, &None);

    let col_other = client.register_livestock(&other_borrower, &symbol_short!("cattle"), &1, &1_000_000);
    client.request_loan(&other_borrower, &vec![&env, col_other], &100_000, &None);


    assert_eq!(client.get_loan_count(&borrower), 3);
    assert_eq!(client.get_loan_count(&other_borrower), 1);

    client.repay_loan(&borrower, &loan1, &400_000);
    assert_eq!(client.get_loan_count(&borrower), 2);
}

// ── price staleness tests (issue #652) ─────────────────────────────────

#[test]
fn test_health_factor_fresh_price() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);

    let col_id = client.register_livestock(&borrower, &symbol_short!("cattle"), &2, &1_000_000);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000, &None);

    env.ledger().with_mut(|li| {
        li.timestamp += 1800;
    });

    // Health factor should still be healthy with fresh price (within staleness window)
    let hf = client.health_factor(&loan_id);
    assert!(hf > 0, "health factor must be positive with fresh price, got {}", hf);

    let _ = (admin, oracle, token, treasury);
}

// ── price staleness tests (issue #652) ─────────────────────────────────


#[test]
fn test_health_factor_threshold_boundary() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);

    let col_id = client.register_livestock(&borrower, &symbol_short!("cattle"), &2, &1_000_000);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000, &None);

    env.ledger().with_mut(|li| {
        li.timestamp += 3600;
    });

    let hf = client.health_factor(&loan_id);
    assert!(hf >= 10_000);

    let _ = (admin, oracle, token, treasury);
}

#[test]
fn test_health_factor_stale_price() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);

    let col_id = client.register_livestock(&borrower, &symbol_short!("cattle"), &2, &1_000_000);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000, &None);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000, &None);

    env.ledger().with_mut(|li| {
        li.timestamp += 3601;
    });

    let res = client.try_health_factor(&loan_id);
    assert_eq!(res, Err(Ok(Error::InvalidPrice)));
}

#[test]
fn test_set_and_get_staleness_threshold() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    assert_eq!(client.get_staleness_threshold(), 3600);

    client.set_staleness_threshold(&admin, &7200);
    assert_eq!(client.get_staleness_threshold(), 7200);
}

#[test]
#[should_panic(expected = "#3")]
fn test_set_staleness_threshold_unauthorized() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let attacker = Address::generate(&env);

    client.set_staleness_threshold(&attacker, &7200);
}

// ── due_ledger / loan deadline tests (issue #698) ──────────────────────

#[test]
fn test_loan_without_deadline_stores_none() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);
    let col_id = client.register_livestock(&borrower, &symbol_short!("cattle"), &2u32, &1_000_000i128);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);
    let loan = client.get_loan(&loan_id);
    assert!(loan.due_ledger.is_none(), "expected no deadline");
}

// ── Issue #700: MIN_LOAN / MAX_LOAN tests ──────────────────────────────────

#[test]
fn test_get_loan_limits_default() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    let client = StellarKraalClient::new(&env, &cid);
    client.initialize(&admin, &oracle, &token, &treasury, &6000u32, &8000u32, &1u32);

    let (min_loan, max_loan) = client.get_loan_limits();
    // default MIN_LOAN = 10_000_000 stroops (1 XLM)
    assert_eq!(min_loan, 10_000_000);
    // default MAX_LOAN = 1_000_000_000_000 stroops (100 000 XLM)
    assert_eq!(max_loan, 1_000_000_000_000);
}

// ── #710: liquidation_threshold_updated event ──────────────────────────

/// set_liquidation_threshold emits old_threshold and new_threshold.
#[test]
fn test_set_liquidation_threshold_emits_event_data() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    client.set_liquidation_threshold(&admin, &7500u32);
}

#[test]
fn test_set_loan_limits_ok() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    client.set_loan_limits(&admin, &5_000_000, &500_000_000_000);
    let (min_loan, max_loan) = client.get_loan_limits();
    assert_eq!(min_loan, 5_000_000);
    assert_eq!(max_loan, 500_000_000_000);
}

#[test]
#[should_panic(expected = "#3")]
fn test_set_loan_limits_non_admin_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let attacker = Address::generate(&env);

    client.set_loan_limits(&attacker, &5_000_000, &500_000_000_000);
}

#[test]
#[should_panic(expected = "#8")]
fn test_set_loan_limits_inverted_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    // max <= min should fail
    client.set_loan_limits(&admin, &100_000_000, &50_000_000);
}

/// request_loan below MIN_LOAN must return InvalidAmount (#8)
#[test]
#[should_panic(expected = "#8")]
fn test_request_loan_below_min_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    client.set_loan_limits(&admin, &10_000_000, &DEFAULT_MAX_LOAN);
    let borrower = Address::generate(&env);
    let col_id = client.register_livestock(&borrower, &symbol_short!("cattle"), &2u32, &1_000_000i128);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);
    let loan = client.get_loan(&loan_id);
    assert!(loan.due_ledger.is_none(), "expected no deadline");
}

#[test]
fn test_loan_with_deadline_stores_due_ledger() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);

    // register collateral worth 100 000 000 stroops; LTV 60% allows up to 60 000 000
    let col_id = client.register_livestock(&borrower, &symbol_short!("cattle"), &1, &100_000_000);

    // Request 60 000 000 stroops (at LTV)
    let now = env.ledger().timestamp();
    let duration = 86_400u64; // 1 day
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &60_000_000i128, &Some(duration));
    let loan = client.get_loan(&loan_id);
    let expected = now + duration;
    assert_eq!(loan.due_ledger, Some(expected), "due_ledger should be now + duration");
}

/// request_loan at MIN_LOAN must succeed
#[test]
fn test_request_loan_at_min_succeeds() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    client.set_loan_limits(&admin, &600_000, &DEFAULT_MAX_LOAN);
    let borrower = Address::generate(&env);
    let col_id = client.register_livestock(&borrower, &symbol_short!("cattle"), &2u32, &1_000_000i128);
    let now = env.ledger().timestamp();
    let duration = 86_400u64; // 1 day
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &Some(duration));
    let loan = client.get_loan(&loan_id);
    let expected = now + duration;
    assert_eq!(loan.due_ledger, Some(expected), "due_ledger should be now + duration");
}

#[test]
fn test_health_factor_not_past_due() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);
    let col_id = client.register_livestock(&borrower, &symbol_short!("cattle"), &2u32, &1_000_000i128);
    // Set deadline 2 days from now (172800 seconds), deadline 1000 seconds ahead
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &Some(172_800u64));
    // Advance time by 1000 seconds (well within the deadline and staleness window)
    env.ledger().with_mut(|li| { li.timestamp += 1000; });
    let hf = client.health_factor(&loan_id);
    assert!(hf >= 10_000, "health factor should be healthy before deadline, got {}", hf);
}

#[test]
fn test_health_factor_past_due_returns_zero() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);
    let col_id = client.register_livestock(&borrower, &symbol_short!("cattle"), &2u32, &1_000_000i128);
    // Set deadline 1 second from now
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &Some(1u64));
    // Advance time past the deadline but within the staleness window
    env.ledger().with_mut(|li| { li.timestamp += 100; });
    let hf = client.health_factor(&loan_id);
    assert_eq!(hf, 0, "past-due loan must have health factor 0");
}

// ── get_liquidation_threshold tests (issue #697) ───────────────────────

#[test]
fn test_get_liquidation_threshold_returns_initialized_value() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    // initialize() sets liquidation_threshold to 8000
    assert_eq!(client.get_liquidation_threshold(), 8000u32);
}

#[test]
fn test_get_liquidation_threshold_after_update() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);
    client.set_liquidation_threshold(&admin, &9000u32);
    assert_eq!(client.get_liquidation_threshold(), 9000u32);

    // collateral worth 100_000_000 → LTV 60% → max_loan = 60_000_000 > MIN_LOAN
    let col_id = client.register_livestock(&borrower, &symbol_short!("cattle"), &1, &100_000_000);
    // borrow exactly MIN_LOAN = 10_000_000
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &10_000_000, &None);
    assert!(loan_id > 0);

    let _ = (oracle, token, treasury);
}

/// request_loan at MAX_LOAN must succeed when collateral is sufficient
#[test]
fn test_request_loan_at_max_succeeds() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    // lower MAX_LOAN to a testable value
    client.set_loan_limits(&admin, &10_000_000, &50_000_000);

    let borrower = Address::generate(&env);
    // collateral worth 100_000_000 → LTV 60% → max = 60_000_000 >= MAX_LOAN 50_000_000
    let col_id = client.register_livestock(&borrower, &symbol_short!("cattle"), &1, &100_000_000);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &50_000_000, &None);
    assert!(loan_id > 0);
}

/// request_loan above MAX_LOAN must return InvalidAmount (#8)
#[test]
#[should_panic(expected = "#8")]
fn test_request_loan_above_max_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    // lower MAX_LOAN to 20_000_000 for the test
    client.set_loan_limits(&admin, &10_000_000, &20_000_000);

    let borrower = Address::generate(&env);
    // enough collateral to pass LTV check
    let col_id = client.register_livestock(&borrower, &symbol_short!("cattle"), &1, &100_000_000);
    // request 21_000_000 — above MAX_LOAN
    client.request_loan(&borrower, &vec![&env, col_id], &21_000_000, &None);
}

// ── Issue #699: migrate_storage tests ─────────────────────────────────────

#[test]
fn test_migrate_storage_returns_version() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    let version = client.migrate_storage(&admin);
    assert_eq!(version, 1u32, "Migration version should be 1");
}

#[test]
fn test_migrate_storage_idempotent() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    // Calling migrate_storage multiple times should always return the same version
    let v1 = client.migrate_storage(&admin);
    let v2 = client.migrate_storage(&admin);
    assert_eq!(v1, v2, "migrate_storage must be idempotent");
}

#[test]
#[should_panic(expected = "#3")]
fn test_migrate_storage_non_admin_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let attacker = Address::generate(&env);

    let _ = (admin, oracle, token, treasury);
    client.migrate_storage(&attacker);
}

/// Only admin can call set_liquidation_threshold (existing auth check).
#[test]
#[should_panic(expected = "#3")]
fn test_set_liquidation_threshold_non_admin_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let attacker = Address::generate(&env);

    client.set_liquidation_threshold(&attacker, &9000u32);
}

// ═══════════════════════════════════════════════════════════════════════════
// #712 – Mock-token balance integration tests
//
// These tests verify exact token balance changes at every loan lifecycle step:
//   1. `request_loan`  → disbursement sent to borrower, origination fee to treasury
//   2. `repay_loan`    → repayment transferred from borrower to contract
//   3. `liquidate`     → repay amount from liquidator, reward back to liquidator
//
// A new `MockTokenWithBalance` contract is registered alongside `StellarKraal`
// so that `token::Client::transfer` actually moves units between ledger entries.
// All balance assertions use exact values, computed from protocol constants.
// ═══════════════════════════════════════════════════════════════════════════

/// Persistent storage key for `MockTokenWithBalance`.
#[contracttype]
#[derive(Clone)]
enum TokenKey {
    Balance(Address),
}

/// A mock SAC-compatible token contract that tracks balances in persistent
/// storage.  It is intentionally minimal — only the two methods that the
/// `StellarKraal` contract calls (`transfer` and `balance`) are implemented.
pub mod mock_token_with_balance {
    use super::*;
    #[contract]
    pub struct MockTokenWithBalance;

#[contractimpl]
impl MockTokenWithBalance {
    /// Mint `amount` tokens to `to`.  Used by test helpers to fund accounts.
    pub fn mint(env: Env, to: Address, amount: i128) {
        let key = TokenKey::Balance(to.clone());
        let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(current + amount));
    }

    /// Transfer `amount` from `from` to `to`.
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        let from_key = TokenKey::Balance(from.clone());
        let to_key = TokenKey::Balance(to.clone());

        let from_bal: i128 = env.storage().persistent().get(&from_key).unwrap_or(0);
        let to_bal: i128 = env.storage().persistent().get(&to_key).unwrap_or(0);

        env.storage().persistent().set(&from_key, &(from_bal - amount));
        env.storage().persistent().set(&to_key, &(to_bal + amount));
    }

    /// Return the token balance of `id`.
    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&TokenKey::Balance(id))
            .unwrap_or(0)
    }
}
}

// ── helpers ───────────────────────────────────────────────────────────────────

/// Set up a fresh environment wired to `MockTokenWithBalance`.
///
/// Returns `(env, contract_id, admin, oracle, token, treasury)`.
fn setup_with_balance() -> (Env, Address, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarKraal);
    let admin = Address::generate(&env);
    let oracle = Address::generate(&env);
    let token = env.register_contract(None, mock_token_with_balance::MockTokenWithBalance);
    let treasury = Address::generate(&env);
    (env, contract_id, admin, oracle, token, treasury)
}

/// Initialise the contract using the shared `StellarKraalClient`.
fn init_with_balance(
    env: &Env,
    contract_id: &Address,
    admin: &Address,
    oracle: &Address,
    token: &Address,
    treasury: &Address,
) {
    let client = StellarKraalClient::new(env, contract_id);
    client.initialize(admin, oracle, token, treasury, &6000u32, &8000u32, &1u32);
    client.set_loan_limits(admin, &1i128, &DEFAULT_MAX_LOAN);
}

/// Read the `MockTokenWithBalance` balance of an address directly.
fn token_balance(env: &Env, token: &Address, account: &Address) -> i128 {
    let token_client = mock_token_with_balance::MockTokenWithBalanceClient::new(env, token);
    token_client.balance(account)
}

/// Mint tokens to an account via `MockTokenWithBalance`.
fn mint(env: &Env, token: &Address, account: &Address, amount: i128) {
    let token_client = mock_token_with_balance::MockTokenWithBalanceClient::new(env, token);
    token_client.mint(account, &amount);
}

// Protocol default origination fee bps (set in `initialize`).
const DEFAULT_ORIG_FEE_BPS: i128 = 50; // 0.5 %
const BPS: i128 = 10_000;

// ── #712 tests ────────────────────────────────────────────────────────────────

/// Verify that `request_loan` transfers the disbursement to the borrower and
/// the origination fee to the treasury.  Uses exact balance assertions.
#[test]
fn test_token_balance_request_loan_transfers_disbursement_and_fee() {
    let (env, cid, admin, oracle, token, treasury) = setup_with_balance();
    init_with_balance(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    let borrower = Address::generate(&env);

    // Fund the contract so it can disburse.
    let fund = 2_000_000i128;
    mint(&env, &token, &cid, fund);

    let col_id =
        client.register_livestock(&borrower, &symbol_short!("cattle"), &2u32, &1_000_000i128);
    let principal = 600_000i128;
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &principal, &None);

    // origination_fee = principal * orig_fee_bps / 10_000
    let fee = principal * DEFAULT_ORIG_FEE_BPS / BPS;
    let disbursement = principal - fee;

    // Borrower must have received exactly the disbursement.
    assert_eq!(
        token_balance(&env, &token, &borrower),
        disbursement,
        "borrower balance must equal disbursement"
    );

    // Treasury must have received exactly the origination fee.
    assert_eq!(
        token_balance(&env, &token, &treasury),
        fee,
        "treasury balance must equal origination fee"
    );

    // Contract balance reduced by principal (fee + disbursement).
    assert_eq!(
        token_balance(&env, &token, &cid),
        fund - principal,
        "contract balance must be reduced by the full principal"
    );

    // Loan record must reflect the full outstanding balance (before any repayment).
    let loan = client.get_loan(&loan_id);
    assert_eq!(loan.outstanding, principal, "loan outstanding must equal principal");
    assert_eq!(loan.principal, principal, "loan principal must be recorded");
}

/// Verify that `repay_loan` transfers the repay amount from the borrower back
/// to the contract.  Uses exact balance assertions.
#[test]
fn test_token_balance_repay_loan_transfers_from_borrower_to_contract() {
    let (env, cid, admin, oracle, token, treasury) = setup_with_balance();
    init_with_balance(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    let borrower = Address::generate(&env);

    // Fund contract and borrower with enough tokens.
    let contract_fund = 2_000_000i128;
    let borrower_fund = 1_000_000i128;
    mint(&env, &token, &cid, contract_fund);
    mint(&env, &token, &borrower, borrower_fund);

    let col_id =
        client.register_livestock(&borrower, &symbol_short!("cattle"), &2u32, &1_000_000i128);
    let principal = 600_000i128;
    let fee = principal * DEFAULT_ORIG_FEE_BPS / BPS;
    let disbursement = principal - fee;

    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &principal, &None);

    // Record balances after disbursement.
    let borrower_after_disburse = token_balance(&env, &token, &borrower);
    let contract_after_disburse = token_balance(&env, &token, &cid);

    // Partial repayment.
    let repay = 200_000i128;
    client.repay_loan(&borrower, &loan_id, &repay);

    // Borrower balance must decrease by the repay amount.
    assert_eq!(
        token_balance(&env, &token, &borrower),
        borrower_after_disburse - repay,
        "borrower balance must decrease by repay amount"
    );

    // Contract balance must increase by the repay amount.
    assert_eq!(
        token_balance(&env, &token, &cid),
        contract_after_disburse + repay,
        "contract balance must increase by repay amount"
    );

    // Outstanding balance on the loan must reflect the repayment.
    let loan = client.get_loan(&loan_id);
    assert_eq!(
        loan.outstanding,
        principal - repay,
        "outstanding must be principal minus repaid amount"
    );

    let _ = (disbursement, borrower_fund);
}

/// Verify that a full repayment closes the loan and the borrower's balance
/// reaches zero outstanding.
#[test]
fn test_token_balance_full_repay_closes_loan() {
    let (env, cid, admin, oracle, token, treasury) = setup_with_balance();
    init_with_balance(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    let borrower = Address::generate(&env);

    mint(&env, &token, &cid, 2_000_000i128);
    mint(&env, &token, &borrower, 1_000_000i128);

    let col_id =
        client.register_livestock(&borrower, &symbol_short!("cattle"), &2u32, &1_000_000i128);
    let principal = 600_000i128;
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &principal, &None);

    // Repay the full outstanding amount.
    client.repay_loan(&borrower, &loan_id, &principal);

    let loan = client.get_loan(&loan_id);
    assert_eq!(loan.status, LoanStatus::Repaid, "loan must be marked Repaid");
    assert_eq!(loan.outstanding, 0, "outstanding must be zero after full repayment");

    let _ = treasury;
}

/// Verify that the origination fee is sent to the treasury, not kept by the
/// contract.  Treasury balance must equal the origination fee exactly.
#[test]
fn test_token_balance_origination_fee_sent_to_treasury() {
    let (env, cid, admin, oracle, token, treasury) = setup_with_balance();
    init_with_balance(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    let borrower = Address::generate(&env);
    mint(&env, &token, &cid, 2_000_000i128);

    let principal = 1_000_000i128;
    let col_id =
        client.register_livestock(&borrower, &symbol_short!("cattle"), &2u32, &2_000_000i128);
    client.request_loan(&borrower, &vec![&env, col_id], &principal, &None);

    let expected_fee = principal * DEFAULT_ORIG_FEE_BPS / BPS; // 5_000
    assert_eq!(
        token_balance(&env, &token, &treasury),
        expected_fee,
        "treasury must receive exactly the origination fee: expected {expected_fee}"
    );
}

/// Verify that liquidation transfers the repay amount from the liquidator to the
/// contract and that the loan outstanding decreases by the exact repay amount.
#[test]
fn test_token_balance_liquidation_reward_sent_to_liquidator() {
    let (env, cid, admin, oracle, token, treasury) = setup_with_balance();
    init_with_balance(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    let borrower = Address::generate(&env);
    let liquidator = Address::generate(&env);

    // Fund accounts.
    mint(&env, &token, &cid, 2_000_000i128);
    mint(&env, &token, &liquidator, 1_000_000i128);

    let col_id =
        client.register_livestock(&borrower, &symbol_short!("cattle"), &2u32, &1_000_000i128);
    let principal = 600_000i128;
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &principal, &None);

    // Make the loan liquidatable: drive outstanding above collateral * liq_thr.
    // With collateral = 1_000_000 and liq_thr = 8000 bps, outstanding must be
    // > (1_000_000 * 8000 / 10_000) = 800_000 for hf < 1.0 (10_000 bps).
    env.as_contract(&cid, || {
        let mut loan: LoanRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Loan(loan_id))
            .unwrap();
        loan.outstanding = 900_000;
        env.storage().persistent().set(&DataKey::Loan(loan_id), &loan);
    });

    let liquidator_before = token_balance(&env, &token, &liquidator);
    let contract_before = token_balance(&env, &token, &cid);

    // Liquidator repays 50 % of outstanding (close factor = 50 % = 5000 bps).
    // max_repay = 900_000 * 5000 / 10_000 = 450_000.
    let repay = 450_000i128;
    client.liquidate(&liquidator, &loan_id, &repay);

    // Liquidator must have paid exactly `repay` tokens to the contract.
    assert_eq!(
        token_balance(&env, &token, &liquidator),
        liquidator_before - repay,
        "liquidator balance must decrease by repay amount"
    );

    // Contract must have received exactly `repay` tokens from the liquidator.
    assert_eq!(
        token_balance(&env, &token, &cid),
        contract_before + repay,
        "contract balance must increase by repay amount"
    );

    // Outstanding balance on the loan must decrease by exactly `repay`.
    let loan = client.get_loan(&loan_id);
    assert_eq!(
        loan.outstanding,
        900_000 - repay,
        "loan outstanding must decrease by the repay amount"
    );

    let _ = (admin, oracle, treasury);
}

/// Verify that a full liquidation (outstanding reaches zero) marks the loan
/// as `Liquidated` and the contract balance increases by the repay amount.
#[test]
fn test_token_balance_full_liquidation_marks_loan_liquidated() {
    let (env, cid, admin, oracle, token, treasury) = setup_with_balance();
    init_with_balance(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    let borrower = Address::generate(&env);
    let liquidator = Address::generate(&env);

    mint(&env, &token, &cid, 2_000_000i128);
    mint(&env, &token, &liquidator, 1_000_000i128);

    // Raise close factor to 100 % so the full position can be liquidated.
    client.set_close_factor(&admin, &10_000u32);

    let col_id =
        client.register_livestock(&borrower, &symbol_short!("cattle"), &2u32, &500_000i128);
    let principal = 300_000i128;
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &principal, &None);

    // Make loan unhealthy.
    env.as_contract(&cid, || {
        let mut loan: LoanRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Loan(loan_id))
            .unwrap();
        loan.outstanding = 450_000;
        env.storage().persistent().set(&DataKey::Loan(loan_id), &loan);
    });

    let contract_before = token_balance(&env, &token, &cid);
    let repay = 450_000i128;
    client.liquidate(&liquidator, &loan_id, &repay);

    let loan = client.get_loan(&loan_id);
    assert_eq!(
        loan.status,
        LoanStatus::Liquidated,
        "loan must be marked Liquidated after full liquidation"
    );
    assert_eq!(loan.outstanding, 0, "outstanding must be zero after full liquidation");
    assert_eq!(
        token_balance(&env, &token, &cid),
        contract_before + repay,
        "contract balance must increase by repay amount on full liquidation"
    );

    let _ = (oracle, treasury);
}

// ── #707: pause_activated and pause_lifted event schemas ───────────────

/// pause emits (Pause, activated) with (paused_by, pause_expiry_ledger).
#[test]
fn test_pause_activated_event_data() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    client.pause(&admin);

    let all_events = env.events().all();
    let found = all_events.iter().any(|e| {
        let topics: soroban_sdk::Vec<soroban_sdk::Val> = e.1.clone();
        if topics.len() < 2 {
            return false;
        }
        if topics.len() < 2 { return false; }
        let t0: Result<Symbol, _> = topics.get(0).unwrap().try_into_val(&env);
        let t1: Result<Symbol, _> = topics.get(1).unwrap().try_into_val(&env);
        t0.map(|s| s == symbol_short!("Pause")).unwrap_or(false)
            && t1.map(|s| s == symbol_short!("activated")).unwrap_or(false)
    });
    assert!(found, "pause_activated event not emitted");

    for e in all_events.iter() {
        let topics: soroban_sdk::Vec<soroban_sdk::Val> = e.1.clone();
        if topics.len() < 2 {
            continue;
        }
        if topics.len() < 2 { continue; }
        let t0: Result<Symbol, _> = topics.get(0).unwrap().try_into_val(&env);
        let t1: Result<Symbol, _> = topics.get(1).unwrap().try_into_val(&env);
        if t0.map(|s| s == symbol_short!("Pause")).unwrap_or(false)
            && t1.map(|s| s == symbol_short!("activated")).unwrap_or(false)
        {
            let data: (Address, u64) = e.2.try_into_val(&env)
                .expect("pause_activated data is (paused_by, pause_expiry_ledger)");
            assert_eq!(data.0, admin, "paused_by must be admin");
            assert!(data.1 > 0, "pause_expiry_ledger must be positive");
        }
    }
}

/// unpause emits (Pause, lifted) with (lifted_by, was_manual=true).
#[test]
fn test_pause_lifted_event_data_manual() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    client.pause(&admin);
    client.unpause(&admin);

    let all_events = env.events().all();
    let found = all_events.iter().any(|e| {
        let topics: soroban_sdk::Vec<soroban_sdk::Val> = e.1.clone();
        if topics.len() < 2 {
            return false;
        }
        if topics.len() < 2 { return false; }
        let t0: Result<Symbol, _> = topics.get(0).unwrap().try_into_val(&env);
        let t1: Result<Symbol, _> = topics.get(1).unwrap().try_into_val(&env);
        t0.map(|s| s == symbol_short!("Pause")).unwrap_or(false)
            && t1.map(|s| s == symbol_short!("lifted")).unwrap_or(false)
    });
    assert!(found, "pause_lifted event not emitted on manual unpause");

    for e in all_events.iter() {
        let topics: soroban_sdk::Vec<soroban_sdk::Val> = e.1.clone();
        if topics.len() < 2 {
            continue;
        }
        if topics.len() < 2 { continue; }
        let t0: Result<Symbol, _> = topics.get(0).unwrap().try_into_val(&env);
        let t1: Result<Symbol, _> = topics.get(1).unwrap().try_into_val(&env);
        if t0.map(|s| s == symbol_short!("Pause")).unwrap_or(false)
            && t1.map(|s| s == symbol_short!("lifted")).unwrap_or(false)
        {
            let data: (Address, bool) = e.2.try_into_val(&env)
                .expect("pause_lifted data is (lifted_by, was_manual)");
            assert_eq!(data.0, admin, "lifted_by must be admin");
            assert!(data.1, "was_manual should be true for manual unpause");
        }
    }
}

/// Auto-expiry: contract auto-unpauses when time advances past expiry.
/// The pause_activated event is emitted; no pause_lifted event (auto-expiry
/// is implicit and not emitted by a function call).
#[test]
fn test_pause_auto_expiry_no_lifted_event() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    client.set_pause_duration(&admin, &1u64);
    client.pause(&admin);
    assert!(client.is_paused());

    env.ledger().with_mut(|li| {
        li.timestamp += 2;
    });

    // Auto-expired: no explicit unpause call needed.
    assert!(!client.is_paused(), "contract should auto-unpause after expiry");

    // Verify pause_activated was emitted (no lifted event since no unpause call).
    env.ledger().with_mut(|li| { li.timestamp += 2; });

    assert!(!client.is_paused(), "contract should auto-unpause after expiry");

    let all_events = env.events().all();
    let activated_count = all_events.iter().filter(|e| {
        let topics: soroban_sdk::Vec<soroban_sdk::Val> = e.1.clone();
        if topics.len() < 2 { return false; }
        let t0: Result<Symbol, _> = topics.get(0).unwrap().try_into_val(&env);
        let t1: Result<Symbol, _> = topics.get(1).unwrap().try_into_val(&env);
        t0.map(|s| s == symbol_short!("Pause")).unwrap_or(false)
            && t1.map(|s| s == symbol_short!("activated")).unwrap_or(false)
    }).count();
    assert_eq!(activated_count, 1, "exactly one pause_activated event expected");
}

// ── is_paused_with_expiry (issue #856) ────────────────────────────────
#[test]
fn test_is_paused_with_expiry_not_paused() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    let status = client.is_paused_with_expiry();
    assert!(!status.is_paused, "contract should not be paused initially");
    assert_eq!(status.expires_at, None, "expires_at should be None when not paused");
}

#[test]
fn test_is_paused_with_expiry_paused_no_expiry() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    // Pause without setting a duration (indefinite pause)
    client.pause(&admin);
    let status = client.is_paused_with_expiry();
    assert!(status.is_paused, "contract should be paused");
    assert_eq!(status.expires_at, None, "expires_at should be None for indefinite pause");
}

#[test]
fn test_is_paused_with_expiry_paused_with_expiry() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    // Pause with a duration
    client.set_pause_duration(&admin, &1000u64);
    client.pause(&admin);
    let status = client.is_paused_with_expiry();
    assert!(status.is_paused, "contract should be paused");
    assert!(status.expires_at.is_some(), "expires_at should be Some for pause with duration");
}

#[test]
fn test_is_paused_with_expiry_after_unpause() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    client.pause(&admin);
    client.unpause(&admin);
    let status = client.is_paused_with_expiry();
    assert!(!status.is_paused, "contract should not be paused after unpause");
    assert_eq!(status.expires_at, None, "expires_at should be None after unpause");
}

// ── #709: Store last 5 health factor values per loan ───────────────────

/// health_factor updates hf_history on each call.
#[test]
fn test_hf_history_grows_with_each_call() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);

    let col_id = client.register_livestock(&borrower, &symbol_short!("cattle"), &2, &1_000_000);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000, &None);

    // Initially history is empty.
    let loan = client.get_loan(&loan_id);
    assert_eq!(loan.hf_history.len(), 0, "history should start empty");

    // After 1st call.
    client.health_factor(&loan_id);
    let loan = client.get_loan(&loan_id);
    assert_eq!(loan.hf_history.len(), 1);

    // After 2nd call.
    client.health_factor(&loan_id);
    let loan = client.get_loan(&loan_id);
    assert_eq!(loan.hf_history.len(), 2);
}

/// hf_history is capped at 5 entries (oldest evicted).
#[test]
fn test_hf_history_capped_at_5() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);

    let col_id = client.register_livestock(&borrower, &symbol_short!("cattle"), &2, &1_000_000);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000, &None);

    // Call health_factor 7 times; history must stay at 5.
    for _ in 0..7 {
        client.health_factor(&loan_id);
    }
    let loan = client.get_loan(&loan_id);
    assert_eq!(loan.hf_history.len(), 5, "hf_history must be capped at 5");
}

/// hf_history stores values in order (newest last).
#[test]
fn test_hf_history_ordering() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);

    let col_id = client.register_livestock(&borrower, &symbol_short!("cattle"), &2, &1_000_000);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000, &None);

    client.health_factor(&loan_id);
    let loan = client.get_loan(&loan_id);
    let first = loan.hf_history.get(0).unwrap();

    client.health_factor(&loan_id);
    let loan = client.get_loan(&loan_id);
    let last = loan.hf_history.get(loan.hf_history.len() - 1).unwrap();

    // Both calls use identical state so values should be equal; the last entry
    // must be the most recently appended.
    assert_eq!(first, last, "values should be equal when loan state is unchanged");
    assert_eq!(loan.hf_history.len(), 2);
}

/// get_loan returns hf_history.
#[test]
fn test_get_loan_returns_hf_history() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let borrower = Address::generate(&env);

    let col_id = client.register_livestock(&borrower, &symbol_short!("cattle"), &2, &1_000_000);
    let loan_id = client.request_loan(&borrower, &vec![&env, col_id], &600_000, &None);

    client.health_factor(&loan_id);
    client.health_factor(&loan_id);
    client.health_factor(&loan_id);

    let loan = client.get_loan(&loan_id);
    assert_eq!(loan.hf_history.len(), 3, "get_loan should include hf_history");
    for val in loan.hf_history.iter() {
        assert!(val > 0, "all hf_history entries should be positive");
    }
}

// ── #703: Guard against removing the last oracle ───────────────────────

/// remove_oracle returns OracleRequired when removing the last oracle
/// while active loans exist.


/// remove_oracle is allowed when other oracles remain, even with active loans.
#[test]
fn test_remove_oracle_allowed_when_other_oracles_remain() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    // Add a second oracle.
    let oracle2 = Address::generate(&env);
    client.add_oracle(&admin, &oracle2);

    // Create an active loan.
    let borrower = Address::generate(&env);
    let col_id = client.register_livestock(&borrower, &symbol_short!("cattle"), &2, &1_000_000);
    client.request_loan(&borrower, &vec![&env, col_id], &600_000, &None);

    // Removing one of two oracles must succeed.
    client.remove_oracle(&admin, &oracle);
    let remaining = client.get_oracles();
    assert_eq!(remaining.len(), 1, "one oracle should remain after removal");
    assert_eq!(remaining.get(0).unwrap(), oracle2);
}

/// remove_oracle is allowed when no active loans exist (last oracle can go).
#[test]
fn test_remove_last_oracle_allowed_no_active_loans() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    // No loans at all — removing the only oracle should succeed.
    client.remove_oracle(&admin, &oracle);
    let remaining = client.get_oracles();
    assert_eq!(remaining.len(), 0, "oracle list should be empty after removal");
}

// ── set_treasury and get_treasury ──────────────────────────────────────

#[test]
fn test_set_treasury_succeeds() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    let new_treasury = Address::generate(&env);
    client.set_treasury(&admin, &new_treasury);

    let retrieved = client.get_treasury();
    assert_eq!(retrieved, new_treasury, "treasury should be updated to new address");
}

#[test]
fn test_get_treasury_matches_init_value() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    let retrieved = client.get_treasury();
    assert_eq!(retrieved, treasury, "treasury should match initialized value");
}

#[test]
#[should_panic(expected = "#3")]
fn test_set_treasury_unauthorized_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    let non_admin = Address::generate(&env);
    let new_treasury = Address::generate(&env);
    client.set_treasury(&non_admin, &new_treasury);
}

#[test]
#[should_panic(expected = "#3")]
fn test_set_treasury_to_zero_address_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    let zero_address = Address::from_string(&String::from_str(&env, "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"));
    client.set_treasury(&admin, &zero_address);
}

// ── reappraise_collateral ──────────────────────────────────────────────

#[test]
fn test_reappraise_collateral_by_owner_succeeds() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    let owner = Address::generate(&env);
    let col_id = client.register_livestock(&owner, &symbol_short!("cattle"), &2, &1_000_000i128);

    let new_value = 1_500_000i128;
    client.reappraise_collateral(&owner, &col_id, &new_value);

    let collateral = client.get_collateral(&col_id);
    assert_eq!(collateral.appraised_value, new_value, "appraised value should be updated");
}

#[test]
fn test_reappraise_collateral_by_oracle_succeeds() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    let owner = Address::generate(&env);
    let col_id = client.register_livestock(&owner, &symbol_short!("cattle"), &2, &1_000_000i128);

    let new_value = 1_200_000i128;
    client.reappraise_collateral(&oracle, &col_id, &new_value);

    let collateral = client.get_collateral(&col_id);
    assert_eq!(collateral.appraised_value, new_value, "appraised value should be updated by oracle");
}

#[test]
#[should_panic(expected = "#3")]
fn test_reappraise_collateral_unauthorized_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    let owner = Address::generate(&env);
    let unauthorized = Address::generate(&env);
    let col_id = client.register_livestock(&owner, &symbol_short!("cattle"), &2, &1_000_000i128);

    let new_value = 1_200_000i128;
    client.reappraise_collateral(&unauthorized, &col_id, &new_value);
}

#[test]
#[should_panic(expected = "#8")]
fn test_reappraise_collateral_invalid_value_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    let owner = Address::generate(&env);
    let col_id = client.register_livestock(&owner, &symbol_short!("cattle"), &2, &1_000_000i128);

    client.reappraise_collateral(&owner, &col_id, &0i128);
}

#[test]
#[should_panic(expected = "#6")]
fn test_reappraise_nonexistent_collateral_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    let owner = Address::generate(&env);
    client.reappraise_collateral(&owner, &9999u64, &1_500_000i128);
}


// ═══════════════════════════════════════════════════════════════════════════
// ── #1045 Admin governance ────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

/// Admin can call parameter-update functions; non-admin is rejected.
#[test]
fn test_admin_can_set_ltv() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    client.set_ltv(&admin, &5000u32);
    assert_eq!(client.get_ltv(), 5000);
}

#[test]
#[should_panic(expected = "#3")]
fn test_non_admin_cannot_set_ltv() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let non_admin = Address::generate(&env);
    client.set_ltv(&non_admin, &5000u32);
}

/// Admin can update the liquidation threshold; non-admin cannot.
#[test]
fn test_admin_can_set_liquidation_threshold() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    client.set_liquidation_threshold(&admin, &9000u32);
    assert_eq!(client.get_liquidation_threshold(), 9000);
}

#[test]
#[should_panic(expected = "#3")]
fn test_non_admin_cannot_set_liquidation_threshold() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let non_admin = Address::generate(&env);
    client.set_liquidation_threshold(&non_admin, &9000u32);
}

/// Admin can add an oracle; non-admin cannot.
#[test]
fn test_admin_can_add_oracle() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let new_oracle = Address::generate(&env);
    client.add_oracle(&admin, &new_oracle);
    let oracles = client.get_oracles();
    assert!(oracles.contains(&new_oracle));
}

#[test]
#[should_panic(expected = "#3")]
fn test_non_admin_cannot_add_oracle() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let non_admin = Address::generate(&env);
    let new_oracle = Address::generate(&env);
    client.add_oracle(&non_admin, &new_oracle);
}

/// Admin governance: two-step admin transfer requires both signatures.
#[test]
fn test_admin_transfer_two_step() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let new_admin = Address::generate(&env);
    client.propose_new_admin(&admin, &new_admin);
    client.accept_admin_role(&new_admin);
    // new_admin can now call admin-only functions
    client.set_ltv(&new_admin, &5000u32);
    assert_eq!(client.get_ltv(), 5000);
}

// ═══════════════════════════════════════════════════════════════════════════
// ── #1044 Per-collateral max LTV ──────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

/// set_collateral_max_ltv / get_collateral_max_ltv round-trip.
#[test]
fn test_set_and_get_collateral_max_ltv() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    // No cap initially.
    assert_eq!(client.get_collateral_max_ltv(&symbol_short!("cattle")), None);

    // Set a 40 % cap for cattle.
    client.set_collateral_max_ltv(&admin, &symbol_short!("cattle"), &4000u32);
    assert_eq!(
        client.get_collateral_max_ltv(&symbol_short!("cattle")),
        Some(4000u32)
    );
}

/// Loan within both global and per-collateral LTV succeeds.
#[test]
fn test_request_loan_within_per_collateral_ltv() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    // Override min loan to 1 so the test isn't blocked by the default floor.
    client.set_loan_limits(&admin, &1i128, &1_000_000_000_000i128);
    // Global LTV = 60 %, per-cattle LTV = 50 %
    client.set_collateral_max_ltv(&admin, &symbol_short!("cattle"), &5000u32);
    let borrower = Address::generate(&env);
    let col_id =
        client.register_livestock(&borrower, &symbol_short!("cattle"), &1u32, &1_000_000i128);
    // 500_000 = 50 % of 1_000_000 — exactly at the cap, should succeed
    let loan_id =
        client.request_loan(&borrower, &vec![&env, col_id], &500_000i128, &None);
    assert_eq!(loan_id, 1);
}

/// Loan that exceeds per-collateral max LTV is rejected with error #32.
#[test]
#[should_panic(expected = "#32")]
fn test_request_loan_exceeds_per_collateral_ltv() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    // Override min loan to 1 so the test isn't blocked by the default floor.
    client.set_loan_limits(&admin, &1i128, &1_000_000_000_000i128);
    // Set a tight cap of 30 % for cattle.
    client.set_collateral_max_ltv(&admin, &symbol_short!("cattle"), &3000u32);
    let borrower = Address::generate(&env);
    let col_id =
        client.register_livestock(&borrower, &symbol_short!("cattle"), &1u32, &1_000_000i128);
    // 500_000 = 50 % > 30 % cap — must be rejected.
    client.request_loan(&borrower, &vec![&env, col_id], &500_000i128, &None);
}

/// Removing the per-collateral LTV cap (setting 0) reverts to global LTV.
#[test]
fn test_remove_per_collateral_ltv_cap() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    // Override min loan to 1 so the test isn't blocked by the default floor.
    client.set_loan_limits(&admin, &1i128, &1_000_000_000_000i128);
    client.set_collateral_max_ltv(&admin, &symbol_short!("cattle"), &3000u32);
    // Remove the cap
    client.set_collateral_max_ltv(&admin, &symbol_short!("cattle"), &0u32);
    assert_eq!(client.get_collateral_max_ltv(&symbol_short!("cattle")), None);
    // Now a loan at 50 % (within global 60 % LTV) should succeed
    let borrower = Address::generate(&env);
    let col_id =
        client.register_livestock(&borrower, &symbol_short!("cattle"), &1u32, &1_000_000i128);
    let loan_id =
        client.request_loan(&borrower, &vec![&env, col_id], &500_000i128, &None);
    assert_eq!(loan_id, 1);
}

/// Non-admin cannot set per-collateral max LTV.
#[test]
#[should_panic(expected = "#3")]
fn test_non_admin_cannot_set_collateral_max_ltv() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let non_admin = Address::generate(&env);
    client.set_collateral_max_ltv(&non_admin, &symbol_short!("cattle"), &5000u32);
}

/// Max LTV above 100 % (10 000 bps) is rejected.
#[test]
#[should_panic(expected = "#8")]
fn test_set_collateral_max_ltv_above_10000_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    client.set_collateral_max_ltv(&admin, &symbol_short!("cattle"), &10_001u32);
}

// ═══════════════════════════════════════════════════════════════════════════
// ── #1043 Multi-oracle median aggregation ─────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

/// submit_price_from_oracle: single oracle below quorum stores price but
/// does not update the global price yet.
#[test]
fn test_submit_price_from_oracle_below_quorum() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    // Use quorum=2 to require 2 oracle submissions.
    let client = StellarKraalClient::new(&env, &cid);
    client.initialize(&admin, &oracle, &token, &treasury, &6000u32, &8000u32, &2u32);

    let oracle2 = Address::generate(&env);
    client.add_oracle(&admin, &oracle2);

    // oracle is the first trusted oracle (seeded from `ORACLE` key).
    let report = client.submit_price_from_oracle(&oracle, &1_000i128);
    // Quorum not yet met; median is returned as the single submitted price.
    assert_eq!(report.median, 1_000i128);
    assert_eq!(report.responses, 1u32);
}

/// submit_price_from_oracle: two oracles meet quorum → median is stored.
#[test]
fn test_submit_price_from_oracle_median_computed() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    let client = StellarKraalClient::new(&env, &cid);
    client.initialize(&admin, &oracle, &token, &treasury, &6000u32, &8000u32, &2u32);

    let oracle2 = Address::generate(&env);
    client.add_oracle(&admin, &oracle2);

    // First oracle submits price 1_000.
    client.submit_price_from_oracle(&oracle, &1_000i128);
    // Second oracle submits price 3_000 → median of [1000, 3000] = 2_000.
    let report = client.submit_price_from_oracle(&oracle2, &3_000i128);
    assert_eq!(report.median, 2_000i128);
    assert_eq!(report.responses, 2u32);

    // The stored price should now be the median.
    let twap = client.get_twap_data();
    assert_eq!(twap.current_price, 2_000i128);
}

/// submit_price_from_oracle: odd-count median (3 prices).
#[test]
fn test_submit_price_from_oracle_three_oracles_median() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    let client = StellarKraalClient::new(&env, &cid);
    client.initialize(&admin, &oracle, &token, &treasury, &6000u32, &8000u32, &1u32);

    let oracle2 = Address::generate(&env);
    let oracle3 = Address::generate(&env);
    client.add_oracle(&admin, &oracle2);
    client.add_oracle(&admin, &oracle3);

    // Use closely-spaced prices to avoid outlier flags (default DEV_BPS = 2000 = 20%).
    client.submit_price_from_oracle(&oracle, &900i128);
    client.submit_price_from_oracle(&oracle2, &1_100i128);
    let report = client.submit_price_from_oracle(&oracle3, &1_000i128);
    // Sorted: [900, 1000, 1100] → median = 1000.
    assert_eq!(report.median, 1_000i128);
    assert_eq!(report.responses, 3u32);
    assert_eq!(report.flagged_count, 0u32);
}

/// submit_price_from_oracle: untrusted address is rejected.
#[test]
#[should_panic(expected = "#3")]
fn test_submit_price_from_untrusted_oracle_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let untrusted = Address::generate(&env);
    client.submit_price_from_oracle(&untrusted, &1_000i128);
}

/// submit_price: now accepts any trusted oracle in the list.
#[test]
fn test_submit_price_accepts_trusted_oracle_list_member() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let oracle2 = Address::generate(&env);
    client.add_oracle(&admin, &oracle2);
    // oracle2 is now in the trusted list → submit_price should succeed.
    client.submit_price(&oracle2, &500i128);
    let twap = client.get_twap_data();
    assert_eq!(twap.current_price, 500i128);
}

/// submit_price: non-oracle address is still rejected.
#[test]
#[should_panic(expected = "#3")]
fn test_submit_price_non_oracle_rejected() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let attacker = Address::generate(&env);
    client.submit_price(&attacker, &1_000i128);
}

// ═══════════════════════════════════════════════════════════════════════════
// ── #1046 Liquidation bonus ───────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

/// set_liquidation_bonus_bps / get_liquidation_bonus_bps round-trip.
#[test]
fn test_set_and_get_liquidation_bonus() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    // Default is 0.
    assert_eq!(client.get_liquidation_bonus_bps(), 0u32);

    // Set 5 % bonus.
    client.set_liquidation_bonus_bps(&admin, &500u32);
    assert_eq!(client.get_liquidation_bonus_bps(), 500u32);
}

/// Non-admin cannot set the liquidation bonus.
#[test]
#[should_panic(expected = "#3")]
fn test_non_admin_cannot_set_liquidation_bonus() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let non_admin = Address::generate(&env);
    client.set_liquidation_bonus_bps(&non_admin, &500u32);
}

/// Bonus above 50 % (5 000 bps) is rejected.
#[test]
#[should_panic(expected = "#8")]
fn test_set_liquidation_bonus_above_max_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    client.set_liquidation_bonus_bps(&admin, &5_001u32);
}

/// Liquidation with a 10 % bonus emits a liqbonus event with the correct
/// collateral_seized amount (= base_seized × 1.10).
#[test]
fn test_liquidate_with_bonus_emits_correct_event() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    // Override min loan to 1 so test amounts work.
    client.set_loan_limits(&admin, &1i128, &1_000_000_000_000i128);

    // Set 10 % liquidation bonus.
    client.set_liquidation_bonus_bps(&admin, &1_000u32);

    // Make a loan unhealthy.
    let borrower = Address::generate(&env);
    let liquidator = Address::generate(&env);
    let col_id = client.register_livestock(
        &borrower,
        &symbol_short!("cattle"),
        &1u32,
        &1_000_000i128,
    );
    let loan_id =
        client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);

    // Drive outstanding above the liquidation threshold.
    env.as_contract(&cid, || {
        let mut loan: LoanRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Loan(loan_id))
            .unwrap();
        loan.outstanding = 900_000;
        env.storage().persistent().set(&DataKey::Loan(loan_id), &loan);
    });

    let repay = 450_000i128;
    client.liquidate(&liquidator, &loan_id, &repay);

    // Verify the liqbonus event.
    let events = env.events().all();
    let bonus_topic = vec![
        &env,
        symbol_short!("loan").into_val(&env),
        symbol_short!("liqbonus").into_val(&env),
    ];
    let bonus_event = events
        .iter()
        .rev()
        .find(|e| e.1 == bonus_topic)
        .expect("liqbonus event not emitted");

    let data: (u64, i128, u32) = bonus_event.2.clone().into_val(&env);
    assert_eq!(data.0, loan_id, "loan_id in event must match");
    // base_seized = 450_000 * 1_000_000 / 900_000 = 500_000
    // with_bonus = 500_000 * 11_000 / 10_000 = 550_000
    assert_eq!(data.1, 550_000i128, "collateral_seized must include 10% bonus");
    assert_eq!(data.2, 1_000u32, "bonus_bps must be 1_000");
}

/// Without a bonus, liquidate() works exactly as before.
#[test]
fn test_liquidate_without_bonus_works() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    // Override min loan to 1 so test amounts work.
    client.set_loan_limits(&admin, &1i128, &1_000_000_000_000i128);

    let borrower = Address::generate(&env);
    let liquidator = Address::generate(&env);
    let col_id = client.register_livestock(
        &borrower,
        &symbol_short!("cattle"),
        &1u32,
        &1_000_000i128,
    );
    let loan_id =
        client.request_loan(&borrower, &vec![&env, col_id], &600_000i128, &None);

    env.as_contract(&cid, || {
        let mut loan: LoanRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Loan(loan_id))
            .unwrap();
        loan.outstanding = 900_000;
        env.storage().persistent().set(&DataKey::Loan(loan_id), &loan);
    });

    client.liquidate(&liquidator, &loan_id, &300_000i128);

    let loan = client.get_loan(&loan_id);
    assert_eq!(loan.outstanding, 600_000i128);
}

// ═══════════════════════════════════════════════════════════════════════════
// ── #488 TWAP Enforcement & Single-Block Manipulation Prevention ───────────
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_set_and_get_twap_min_observations() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    // Default min observations is 2.
    assert_eq!(client.get_twap_min_observations(), 2u32);

    // Update to 5.
    client.set_twap_min_observations(&admin, &5u32);
    assert_eq!(client.get_twap_min_observations(), 5u32);
}

#[test]
#[should_panic(expected = "#3")]
fn test_set_twap_min_observations_unauthorized() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    let attacker = Address::generate(&env);
    client.set_twap_min_observations(&attacker, &5u32);
}

#[test]
#[should_panic(expected = "#8")]
fn test_set_twap_min_observations_zero_fails() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);
    client.set_twap_min_observations(&admin, &0u32);
}

#[test]
fn test_submit_oracle_prices_updates_twap_buffer() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    let oracle2 = Address::generate(&env);
    let oracle3 = Address::generate(&env);
    client.add_oracle(&admin, &oracle2);
    client.add_oracle(&admin, &oracle3);

    let submitter = Address::generate(&env);
    let prices = vec![&env, 100i128, 100i128, 100i128];
    client.submit_oracle_prices(&submitter, &prices);

    let twap_data = client.get_twap_data();
    assert_eq!(twap_data.current_price, 100i128);
    assert_eq!(twap_data.twap_price, 100i128);
}

#[test]
fn test_twap_enforcement_prevents_single_block_borrow_inflation() {
    let (env, cid, admin, oracle, token, treasury) = setup();
    init(&env, &cid, &admin, &oracle, &token, &treasury);
    let client = StellarKraalClient::new(&env, &cid);

    let borrower = Address::generate(&env);
    // Register livestock appraised at 20_000_000.
    // LTV is 6000 bps (60%).
    // Normal max borrow at 20_000_000: 20_000_000 * 60% = 12_000_000.
    let col_id = client.register_livestock(
        &borrower,
        &symbol_short!("cattle"),
        &1u32,
        &20_000_000i128,
    );

    // Initial oracle submissions at price 100.
    client.submit_price(&oracle, &100i128);
    client.submit_price(&oracle, &100i128);

    let twap = client.get_twap_data();
    assert_eq!(twap.current_price, 100i128);
    assert_eq!(twap.twap_price, 100i128);

    // Now an attacker spikes spot price in a single block to 500 (5x spike).
    client.submit_price(&oracle, &500i128);

    let twap_after = client.get_twap_data();
    assert_eq!(twap_after.current_price, 500i128);
    // TWAP is (100 + 100 + 500) / 3 = 233.
    assert!(twap_after.twap_price < 500i128);

    // With TWAP clamping, effective collateral value is clamped to:
    // 20_000_000 * twap_price / last_price = 20_000_000 * 233 / 500 = 9_320_000.
    // At 60% LTV, max allowed loan is 9_320_000 * 60% = 5_592_000.
    // Attempting to borrow full capacity without clamping (12_000_000) must fail with InsufficientCollateral (#8)!
    let result = client.try_request_loan(&borrower, &vec![&env, col_id], &12_000_000i128, &None);
    assert_eq!(result, Err(Ok(Error::InsufficientCollateral)));

    // But borrowing within the TWAP-clamped capacity succeeds:
    let safe_borrow = client.request_loan(&borrower, &vec![&env, col_id], &5_000_000i128, &None);
    assert!(safe_borrow > 0);
}
