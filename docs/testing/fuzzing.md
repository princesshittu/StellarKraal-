# Fuzz Testing Guide - StellarKraal Smart Contract

## Overview

Fuzz testing feeds random or semi-random inputs into a program to discover edge
cases and arithmetic bugs that hand-written tests miss. The StellarKraal smart
contract is fuzzed with [`cargo-fuzz`](https://github.com/rust-fuzz/cargo-fuzz)
(libFuzzer) to machine-verify the protocol's critical financial invariants.

The fuzz harness lives in [`contracts/stellarkraal/fuzz/`](../../contracts/stellarkraal/fuzz)
and is a standalone Cargo workspace so it can link the libFuzzer host runtime
independently of the `#![no_std]` contract crate.

> **Complementary property tests:** `contracts/stellarkraal/src/tests.rs` also
> contains `proptest`-based property tests (`prop_*`) that exercise the live
> contract through its client. The `cargo-fuzz` targets documented here focus on
> the pure arithmetic invariants and run under a dedicated time-limited CI job.

---

## Contents

1. [Why Fuzz Testing?](#why-fuzz-testing)
2. [Quick Start: Run Existing Targets Locally](#quick-start-run-existing-targets-locally)
3. [Writing a New Fuzz Target](#writing-a-new-fuzz-target)
4. [Fuzz Targets Reference](#fuzz-targets-reference)
5. [CI Integration](#ci-integration)
6. [Corpus and Artifacts](#corpus-and-artifacts)
7. [Common Fuzz Findings and Triage](#common-fuzz-findings-and-triage)
8. [Best Practices](#best-practices)
9. [References](#references)

---

## Why Fuzz Testing?

The contract's arithmetic (health factor, LTV cap, origination/interest fees) is
hard to test exhaustively by hand. libFuzzer generates millions of inputs per
run and shrinks any failing case to a minimal reproducer, so invariants are
verified across the whole input space rather than at a handful of chosen points.

---

## Quick Start: Run Existing Targets Locally

### Step 1 — Install the nightly Rust toolchain

libFuzzer requires a nightly compiler. Install and set it as the override for
the contracts directory:

```bash
rustup install nightly
rustup override set nightly --path contracts/stellarkraal
```

Verify:

```bash
rustc +nightly --version   # should print rustc 1.xx.0-nightly (...)
```

### Step 2 — Install `cargo-fuzz`

```bash
cargo install cargo-fuzz --locked
```

`cargo-fuzz` is a CLI tool, not a crate dependency. The harness itself depends
only on `libfuzzer-sys` and `arbitrary` (declared in
`contracts/stellarkraal/fuzz/Cargo.toml`).

### Step 3 — List available targets

From the `contracts/stellarkraal/` directory:

```bash
cd contracts/stellarkraal
cargo +nightly fuzz list
```

Expected output:

```
health_factor
loan_request
loan_arithmetic
```

### Step 4 — Run a target

```bash
# Run health_factor until you press Ctrl-C
cargo +nightly fuzz run health_factor

# Run for a bounded time (matches CI: 60 seconds)
cargo +nightly fuzz run health_factor -- -max_total_time=60

# Run loan_request with extra verbosity to see coverage stats
cargo +nightly fuzz run loan_request -- -max_total_time=60 -print_final_stats=1
```

A successful run ends with output like:

```
#1000000 DONE   cov: 42 ft: 89 corp: 12/256b lim: 96 exec/s: 16666 rss: 30Mb
Done 1000000 runs in 60 second(s)
```

No output with `CRASH`, `ASSERT`, or `ERROR` means all generated inputs
satisfied the invariants.

### Step 5 — Reproduce a previous crash (optional)

If the CI uploaded a crash artifact, copy it to the artifacts directory and run:

```bash
cargo +nightly fuzz run health_factor fuzz/artifacts/health_factor/<crash-file>
```

---

## Writing a New Fuzz Target

Follow these steps whenever you add a new financial calculation to the contract.

### Step 1 — Decide what to fuzz

Identify the invariants you want to verify. Good candidates are:

- Pure arithmetic functions (health factor, fees, LTV)
- Any function that could overflow or underflow with unexpected inputs
- Input validation logic (what should be accepted vs. rejected)

### Step 2 — Create the target file

```bash
# From contracts/stellarkraal/
cargo +nightly fuzz add my_new_target
```

This creates `fuzz/fuzz_targets/my_new_target.rs` with a starter template.

### Step 3 — Write the harness

Open the generated file and replace the template with your target. The pattern is:

```rust
#![no_main]

use libfuzzer_sys::fuzz_target;
use arbitrary::Arbitrary;

// Define the structured input your target needs
#[derive(Arbitrary, Debug)]
struct MyInput {
    value_a: i128,
    value_b: i128,
    // constrain ranges in the harness, not the struct
}

fuzz_target!(|input: MyInput| {
    // 1. Filter inputs the contract legitimately rejects
    if input.value_a <= 0 || input.value_b <= 0 {
        return;
    }

    // 2. Call the function under test
    let result = my_contract_function(input.value_a, input.value_b);

    // 3. Assert the invariants that must always hold
    match result {
        Some(r) => {
            assert!(r >= 0, "result must be non-negative");
            assert!(r <= i128::MAX / 2, "result must not overflow");
        }
        None => {
            // None means the contract rejected the input — that's fine
        }
    }
});
```

Key guidelines:

- **Use `#[derive(Arbitrary)]`** so libFuzzer can generate structured inputs automatically.
- **Return early** (not panic) for inputs the contract legitimately rejects. Panicking on expected-invalid input generates false positives.
- **Use `checked_*` arithmetic** in both the contract and the harness to match the contract's own overflow handling.
- **Assert the invariants**, not the exact result. Fuzzing is not a unit test.

### Step 4 — Add the dependency to `fuzz/Cargo.toml` (if needed)

If your target uses a new helper from the contract crate, ensure the dependency is already declared. The fuzz workspace inherits from the parent:

```toml
[dependencies]
stellarkraal = { path = "..", features = ["fuzzing"] }
libfuzzer-sys = "0.4"
arbitrary = { version = "1", features = ["derive"] }
```

### Step 5 — Run the new target locally

```bash
cargo +nightly fuzz run my_new_target -- -max_total_time=60
```

Fix any compilation errors, then let it run for at least a few minutes to build
initial corpus coverage.

### Step 6 — Add the target to CI

Open `.github/workflows/fuzz.yml` and add a new run step:

```yaml
- run: cargo +nightly fuzz run my_new_target -- -max_total_time=60
  working-directory: contracts/stellarkraal
```

### Step 7 — Document the target

Add an entry to the [Fuzz Targets Reference](#fuzz-targets-reference) section below,
describing the function mirrored, the input types, and the invariants asserted.

---

## Fuzz Targets Reference

### 1. `health_factor`

**File:** `fuzz/fuzz_targets/health_factor.rs`
**Mirrors:** `StellarKraal::compute_health_factor_with_thr` in `src/lib.rs`
**Formula:** `(collateral * liq_threshold_bps) / (outstanding * 10_000) * 10_000`

**Inputs (arbitrary):**

- `total_collateral_value`: any `i128`
- `outstanding`: any `i128`
- `liq_threshold_bps`: constrained to the contract's valid `1..=10_000` range

**Invariants asserted:**

- The health factor is never negative.
- A fully-repaid loan (`outstanding == 0`) is maximally healthy (`i128::MAX`).
- The liquidation predicate (`health < 1.0`, i.e. `< 10_000`) is total — every
  input the contract would accept yields a defined, non-panicking result.
- No arithmetic overflow occurs (overflowing inputs are rejected via
  `checked_*`, exactly as the contract does).

---

### 2. `loan_request`

**File:** `fuzz/fuzz_targets/loan_request.rs`
**Mirrors:** the amount/fee logic of `StellarKraal::request_loan` in `src/lib.rs`

**Inputs (arbitrary):**

- `total_collateral_value`: any `i128`
- `amount`: any `i128`
- `ltv_bps`: constrained to `0..=10_000`
- `orig_fee_bps`: constrained to `0..=500` (the contract's fee cap)

**Invariants asserted (for approved loans):**

- The principal equals the requested amount and is positive.
- The origination fee is non-negative and never exceeds the principal.
- The disbursement is non-negative and never exceeds the principal.
- `fee + disbursement == principal` (no value is created or lost).
- The approved loan never exceeds the LTV-capped maximum.

Rejected inputs map to the contract's `InvalidAmount` (non-positive amount) and
`InsufficientCollateral` (amount above the LTV cap) outcomes.

---

### 3. `loan_arithmetic`

**File:** `fuzz/fuzz_targets/loan_arithmetic.rs`

Exercises the checked health-factor, LTV, and interest-accrual helpers with arbitrary signed and unsigned inputs. The target treats rejected inputs as `None` and fails only on a panic or overflow.

---

## CI Integration

The [`fuzz.yml`](../../.github/workflows/fuzz.yml) workflow runs on every pull
request that touches `contracts/**`. It installs `cargo-fuzz`, then runs each
target for a time-limited 60-second session:

```yaml
on:
  pull_request:
    paths:
      - "contracts/**"

# ...
      - run: cargo +nightly fuzz run health_factor -- -max_total_time=60
      - run: cargo +nightly fuzz run loan_request -- -max_total_time=60
```

If a target crashes, the failing input is uploaded as a build artifact for
reproduction.

---

## Corpus and Artifacts

libFuzzer stores interesting inputs under `fuzz/corpus/<target>/` and crash
reproducers under `fuzz/artifacts/<target>/`. These directories are
git-ignored. To reproduce a saved crash locally:

```bash
cargo +nightly fuzz run health_factor fuzz/artifacts/health_factor/<crash-file>
```

---

## Common Fuzz Findings and Triage

This section documents classes of bugs the fuzz targets are designed to catch and
how to investigate them when they appear.

### Arithmetic overflow / underflow

**Symptom:** libFuzzer prints `AddressSanitizer: SIGABRT` or an integer overflow
assertion, followed by the failing input bytes.

**Common cause:** A multiplication or addition on `i128` values was not guarded
by `checked_mul` / `checked_add`. libFuzzer found inputs that cause wrapping.

**Triage steps:**

1. Minimize the reproducer:
   ```bash
   cargo +nightly fuzz tmin health_factor fuzz/artifacts/health_factor/<crash-file>
   ```
2. Decode the minimized input — the struct fields are printed in the libFuzzer
   output. Identify which arithmetic operation wrapped.
3. In `src/lib.rs`, replace the bare operator with the checked equivalent and
   return an error code (e.g. `ContractError::Overflow`) rather than panicking.
4. Re-run the target with the fixed reproducer to confirm the crash is gone.

---

### Invariant violation (assertion failure)

**Symptom:** libFuzzer prints `ASSERT` or `panic` followed by the Rust backtrace
pointing to an assertion in the harness.

**Common cause:** A refactor changed the contract logic but not the harness
assertions, or a new edge case was introduced that violates a previously correct
invariant (e.g. `fee + disbursement != principal`).

**Triage steps:**

1. Run the reproducer and read the backtrace to identify which assertion failed.
2. Decide whether the contract or the harness is wrong:
   - If the contract behaviour changed intentionally, update the harness assertion.
   - If the contract behaviour is incorrect, fix the contract logic.
3. Check whether any related unit tests in `src/tests.rs` need updating.

---

### Panic in `unwrap()` / `expect()`

**Symptom:** libFuzzer hits a `called Option::unwrap() on a None value` panic.

**Common cause:** The contract or the harness calls `.unwrap()` on a value that can
be `None` for legitimate inputs (e.g. zero collateral).

**Triage steps:**

1. Replace `.unwrap()` with pattern matching or `.unwrap_or_default()` in the
   harness. In the contract, map `None` to an appropriate `ContractError`.
2. Guard the harness with an early-return for the input class that produces `None`
   if that class represents an intentionally rejected input.

---

### No crash, but coverage plateaued early

**Symptom:** The fuzzer runs for the full 60-second budget but the `cov:` counter
stops increasing after the first few seconds.

**Common cause:** The harness filters too aggressively (e.g. returning early for
most input ranges), leaving libFuzzer unable to explore interesting paths.

**Improvement steps:**

1. Inspect the early-return conditions in the harness. Reduce them to only those
   cases the contract explicitly rejects.
2. Provide manually crafted seed inputs in `fuzz/corpus/<target>/` to guide
   libFuzzer toward boundary values (e.g. `i128::MAX`, `0`, negative numbers).
3. Increase the local run time to build a larger corpus:
   ```bash
   cargo +nightly fuzz run health_factor -- -max_total_time=600
   ```

---

## Best Practices

1. **Run before contract changes** that touch arithmetic.
2. **Extend coverage**: add a new fuzz target when adding a financial calculation.
3. **Keep targets in sync** with the contract logic they mirror, and update this
   guide when targets change.
4. **Commit useful corpus seeds** if a particular input class is worth retaining.
5. **Always use `checked_*` arithmetic** in the contract and mirror that handling in the harness.
6. **Document every new target** in this guide immediately after writing it.

---

## References

- [cargo-fuzz documentation](https://rust-fuzz.github.io/book/cargo-fuzz.html)
- [libFuzzer documentation](https://llvm.org/docs/LibFuzzer.html)
- [StellarKraal Protocol Docs](../protocol/)
