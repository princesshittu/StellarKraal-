# Runbook: High Contract Invocation Failure Rate

## Alert Definition

| Field | Value |
|---|---|
| Alert name | `HighContractInvocationFailureRate` |
| Prometheus expression | `stellarkraal_alert_fired{rule="high-contract-invocation-failure-rate"} > 0` |
| Evaluation window | `5m` |
| Severity | `critical` |
| PagerDuty escalation | Yes |
| Cooldown | 5 minutes |
| Runbook | `docs/runbooks/contract-invocation-failure.md` |
| Dashboard | Grafana → StellarKraal Backend → `?var-alert=high-contract-invocation-failure-rate` |

The alert fires when `fireAlert(rules.highContractInvocationFailureRate, …)` is called from application code — typically when Soroban RPC calls or contract invocations exceed the acceptable failure threshold. The in-process cooldown prevents re-firing within 5 minutes of the last fire, so a single page means the failure is sustained.

Supporting metrics you can query in Grafana/Prometheus:

```promql
# Error rate of all Soroban RPC calls (last 5 minutes)
sum(rate(rpc_call_duration_seconds_count{status="error"}[5m]))
  / sum(rate(rpc_call_duration_seconds_count[5m]))

# Per-operation breakdown (useful to narrow down which RPC call is failing)
rate(rpc_call_duration_seconds_count{status="error"}[5m]) by (operation)

# p99 latency of RPC calls — high latency can precede failures
histogram_quantile(0.99,
  sum(rate(rpc_call_duration_seconds_bucket[5m])) by (le, operation)
)
```

---

## Incident Description

Soroban smart contract calls from the backend are failing at an elevated rate. This blocks user-facing operations including:

- Loan origination (`request_loan`)
- Loan repayment (`repay_loan`)
- Liquidations (`liquidate`)
- Collateral registration (`register_livestock`)

Read-only API endpoints and database queries are unaffected unless the failure originates from a total RPC outage.

---

## Common Causes

| Cause | Signals |
|---|---|
| Contract is paused (error #13 or #21) | All write operations fail with `Contract is paused` |
| Circuit breaker open | `RpcCircuitOpen` alert also firing; logs show `Circuit breaker opened` |
| RPC node unreachable | `RpcFailure` alert also firing; curl health check fails |
| Wrong signer key (error #3) | Errors logged as `Unauthorized`, only certain operations fail |
| Stale or invalid oracle prices (errors #17, #18) | Loan origination and liquidation fail; oracle logs show no recent submissions |
| Bad transaction sequence number | Stellar-level `TX_BAD_SEQ` errors in logs |
| `CONTRACT_ID` misconfigured | All contract calls fail; `stellar contract info` returns 404 |
| Fee rate / parameter misconfiguration (errors #10, #12) | Admin operations fail; runtime errors during parameter updates |
| Upgrade timelock not elapsed (error #25) | Upgrade execution fails after proposal |
| Reentrancy guard triggered (error #20) | Unexpected concurrent calls to the same contract method |
| Arithmetic overflow (error #22) | Edge-case amounts in loan or price calculations |

---

## Diagnostic Steps

Work through these steps in order. Most incidents resolve at step 1, 2, or 3.

### Step 1 — Check related alerts

Before investigating the contract, look at what else is alerting:

- **`RpcCircuitOpen` firing** → The opossum circuit breaker opened because ≥ 50% of calls failed in the last 10 s window. Go to the [RPC Failure Runbook](./rpc-failure.md) first. The contract is healthy; the transport layer is broken.
- **`RpcFailure` firing** → Soroban RPC is intermittently failing. See [RPC Failure Runbook](./rpc-failure.md).
- **`LiquidationFailure` firing** → Contract invocation failure may be a symptom of a broader liquidation engine issue. See [Liquidation Failure Runbook](./liquidation-failure.md).

### Step 2 — Check RPC health

```bash
curl -s -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
  "$RPC_URL"
```

A healthy response returns `{"result":{"status":"healthy",...}}`. If this fails, the RPC node is down — see [RPC Failure Runbook](./rpc-failure.md). Contract-level diagnosis below is only relevant once the RPC is reachable.

### Step 3 — Check contract pause state

```bash
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --network testnet \
  -- is_paused
```

If the contract is paused, **all write operations will fail** (error #13). Check `#incidents` Slack for a planned maintenance pause. If this was unintended, an admin must call `unpause()` immediately (see error #13 remediation below).

To see the expiry of a timed pause:

```bash
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --network testnet \
  -- is_paused_with_expiry
```

### Step 4 — Inspect backend logs for contract error codes

Search Loki (or container logs) for contract error codes:

```logql
# Loki query — errors in the last 30 minutes
{container="backend"} |= "Contract error" | json
```

```bash
# Docker Compose
docker compose logs backend --since 30m | grep -E "Contract error|contractError|Error\(Contract"
```

The backend's `mapSorobanError()` converts raw Soroban error strings like `Error(Contract, #4)` into the human-readable messages listed in the [Error Code Reference](#soroban-error-code-reference) below. Cross-reference the logged message or numeric code with that table.

### Step 5 — Check circuit breaker states

The backend health endpoint exposes circuit breaker state:

```bash
curl -s http://localhost:3001/health | jq '.circuitBreakers'
```

Example output when a breaker is open:

```json
{
  "sendTransaction": "open",
  "prepareTransaction": "closed",
  "simulateTransaction": "closed",
  "getAccount": "closed",
  "getTransaction": "closed",
  "getHealth": "closed"
}
```

An open circuit means the breaker tripped due to sustained failures. It auto-resets after 60 seconds. If it keeps reopening, the underlying RPC is still degraded.

### Step 6 — Verify contract deployment and `CONTRACT_ID`

```bash
stellar contract info \
  --id "$CONTRACT_ID" \
  --network testnet
```

A 404 or unexpected output means `CONTRACT_ID` points to the wrong contract or the contract has not been deployed to the current network. Compare `CONTRACT_ID` in your secrets manager / `.env` against the deployment record in `docs/deployment/contract-deployment.md`.

### Step 7 — Check transaction sequence numbers

Stale or duplicate transactions fail with Stellar-level errors before reaching contract logic. Search for these in logs:

```bash
docker compose logs backend --since 30m | grep -E "TX_BAD_SEQ|tx_insufficient_fee|tx_bad_auth"
```

Sequence number issues typically indicate concurrent requests from multiple backend instances submitting from the same source account. Ensure only one backend instance is active, or implement sequence-number locking.

### Step 8 — Check the event listener (for event-driven paths)

Contract invocation failures in the event listener (polling path) are separate from API-driven failures but can indicate the same underlying problems. Check event listener logs:

```bash
docker compose logs backend --since 30m | grep -E "poll_error|parse_error|event_listener"
```

The listener does not crash on RPC errors — it logs `contract.event.poll_error` and schedules the next poll. However, sustained poll errors alongside API failures confirm a broad RPC or contract issue.

See the [Event Listener Lifecycle Guide](../guides/event-listener-lifecycle.md) for details on error handling, missed events, and polling interval tuning.

---

## Soroban Error Code Reference

The StellarKraal contract defines 26 error codes. The backend translates raw Soroban error strings into these messages via `mapSorobanError()` in `backend/src/utils/sorobanErrors.ts`.

| Code | Message | Primary cause | Typical remediation |
|------|---------|---------------|---------------------|
| #1 | Contract is not initialized | `initialize()` was never called | Call `initialize()` with correct parameters |
| #2 | Contract is already initialized | `initialize()` called more than once | No-op; check deploy script for duplicate calls |
| #3 | Unauthorized | Caller does not match stored admin/owner | Verify signer key; check `BACKEND_SIGNER_SECRET` |
| #4 | Insufficient collateral | Loan amount exceeds `collateral_value × LTV` | Reduce loan amount; verify oracle prices and LTV config |
| #5 | Loan not found | Loan ID does not exist on-chain | Check for off-chain/on-chain sync gap; return 404 to client |
| #6 | Collateral not found | Collateral ID does not exist on-chain | Check for off-chain/on-chain sync gap; return 404 to client |
| #7 | Health factor is safe | Liquidation attempted on a healthy loan | Wait for HF to drop; no action if intentional |
| #8 | Invalid amount | Zero, negative, or overflow-causing value | Validate amounts in backend before submitting |
| #9 | Loan is already closed | Repay/liquidate called on a settled loan | Return 409 to client; sync off-chain DB state |
| #10 | Invalid fee rate | Fee rate exceeds 5% protocol cap | Reduce fee to ≤ 500 bps; call admin fee setter again |
| #11 | Exceeds close factor | Repayment/liquidation exceeds close-factor cap | Split into partial repayments; admin can adjust close factor |
| #12 | Invalid close factor | Close factor outside 1–10000 bps range | Set close factor to a value between 1 and 10000 |
| #13 | Contract is paused | Admin triggered pause; write ops blocked (repayment allowed) | Admin calls `unpause(admin)`; check `#incidents` for planned maintenance |
| #14 | Oracle already registered | Duplicate oracle registration attempt | No-op; verify oracle list before registering |
| #15 | Oracle limit reached | Max oracle count hit | Remove an inactive oracle with `remove_oracle(admin, addr)` |
| #16 | Oracle not found | Removing/updating a non-existent oracle | Verify address; oracle may already be removed |
| #17 | Insufficient oracle quorum | Too few oracles have submitted recent prices | Check oracle infra; lower quorum or add oracles |
| #18 | Invalid price | Oracle submitted zero/negative/out-of-bounds price | Investigate oracle data feed; review price bounds config |
| #19 | Contract is not paused | `unpause()` called when contract is already active | No-op |
| #20 | Reentrancy guard | Concurrent call already in progress | Reduce concurrency; check for duplicate requests in flight |
| #21 | Contract is already paused | `pause()` called when already paused | No-op |
| #22 | Arithmetic overflow | Extreme values causing u128 overflow | Validate amounts; check unit conversions (stroops vs XLM) |
| #23 | Not a whitelisted liquidator | Caller address not on the liquidator whitelist | Add the address to the whitelist via admin function |
| #24 | No upgrade pending | `execute_upgrade()` called before `propose_upgrade()` | Call `propose_upgrade()` first |
| #25 | Timelock not elapsed | 24-hour upgrade delay has not passed | Wait until the timelock expires before executing the upgrade |
| #26 | Oracle required | Attempted to remove the last oracle while active loans exist | Settle or migrate active loans first; or add another oracle before removing |

### Detailed remediation for high-frequency errors

#### Error #3 — Unauthorized

```bash
# Verify which account the backend is signing as
echo $BACKEND_SIGNER_SECRET | stellar keys show

# Compare against the stored contract admin
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --network testnet \
  -- get_admin
```

For user-facing operations, verify the signed transaction includes the correct user signature (returned by `buildContractTx`). For admin operations, ensure `BACKEND_SIGNER_SECRET` in the secrets manager matches the account used during `initialize()`.

#### Error #4 — Insufficient Collateral

```bash
# Check current LTV ratio
stellar contract invoke --id "$CONTRACT_ID" --network testnet -- get_ltv

# Check the collateral appraisal value
stellar contract invoke \
  --id "$CONTRACT_ID" --network testnet \
  -- get_collateral --collateral_id <ID>
```

If legitimate loan amounts are being rejected, check whether oracle prices are stale (may also show as error #17 or #18 in adjacent calls).

#### Error #13 — Contract is Paused

```bash
# Check pause status and expiry
stellar contract invoke --id "$CONTRACT_ID" --network testnet -- is_paused_with_expiry
```

- If this is a **planned maintenance pause** → wait for the expiry or for an admin to call `unpause()`.
- If this is an **unintended pause** → admin must call `unpause(admin)` immediately. Alert `#incidents`.
- Note: repayments are still allowed while paused; only new loans and liquidations are blocked.

#### Errors #17 / #18 — Oracle failures

```bash
# Check the latest oracle price for an asset
stellar contract invoke \
  --id "$CONTRACT_ID" --network testnet \
  -- get_latest_price --asset <ASSET_SYMBOL>
```

If prices are stale:
1. Check oracle infrastructure and Cron jobs for oracle submission.
2. The admin can lower the quorum requirement with `set_oracle_quorum(admin, new_quorum)` as a temporary measure.
3. If prices are invalid (error #18), identify which oracle submitted the bad value from contract event logs.

---

## Remediation Summary

| Scenario | Immediate action | Longer-term fix |
|---|---|---|
| RPC transport failure | Switch to backup RPC URL; restart backend | Improve RPC provider redundancy |
| Circuit breaker open | Wait 60 s for auto-reset; if it keeps opening, fix underlying RPC | Add retry budget and backoff config |
| Contract paused (planned) | Wait for expiry | Communicate maintenance windows via status page |
| Contract paused (unintended) | Admin calls `unpause(admin)` | Review who has admin key access |
| Wrong signer key | Update `BACKEND_SIGNER_SECRET` in secrets manager; redeploy | Add key-rotation runbook and access control audit |
| Oracle quorum failure | Lower quorum temporarily; fix oracle infra | Monitor oracle uptime; add more oracles |
| `CONTRACT_ID` mismatch | Set correct contract ID in environment; redeploy | Add contract ID validation to startup health check |
| Sequence number collision | Ensure single backend instance; restart to reset in-memory nonce | Implement distributed sequence locking for multi-replica setup |
| Event listener stuck | Restart the backend (listener restarts with it); it will replay missed events from cursor `0` | Persist cursor to DB to avoid full replay on restart |

---

## Escalation Path

1. **First 15 minutes** — Primary on-call investigates using the steps above. Acknowledge in `#incidents` Slack channel.
2. **Error codes #1–#3 (config/deployment)** — Escalate to the **Platform / Infrastructure Engineer**.
3. **Error codes #4–#9, #11–#12 (user-data or sync issues)** — Escalate to the **Backend Engineer** to investigate off-chain database state.
4. **Error codes #13–#26 (admin, oracle, upgrade, reentrancy)** — Escalate to the **Smart Contract / Protocol Team**.
5. **After 15 minutes with no resolution** — Page the Engineering Manager and post in `#incidents`.
6. **P1 declaration** (full loan lifecycle blocked > 15 min) — File a post-mortem issue in GitHub per the on-call policy.

On-call assignments and contact details: [docs/ON_CALL_ROTATION.md](../ON_CALL_ROTATION.md).

---

## Related Runbooks

- [RPC Node Unreachable](./rpc-failure.md) — transport-layer failures before reaching the contract
- [Database Connection Failure](./db-failure.md) — off-chain DB issues that may accompany contract failures
- [Liquidation Failure](./liquidation-failure.md) — liquidation-engine-specific failures

## Related Documentation

- [Event Listener Lifecycle Guide](../guides/event-listener-lifecycle.md) — when the listener starts/stops, error handling, missed events, and replay behaviour
- [Smart Contract Interface](../contracts/stellarkraal-interface.md) — full contract API reference including all function signatures and state changes
- [API Error Code Reference](../api-error-codes.md) — HTTP status codes and contract error code mappings returned to clients
- [Alerting Guide](../guides/alerting.md) — how `fireAlert` works, cooldown behaviour, Slack and PagerDuty integration
- [Observability Stack](../observability.md) — Prometheus metrics, Loki/Grafana dashboards, and how to extend each
