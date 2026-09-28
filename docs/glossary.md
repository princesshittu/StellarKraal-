# Glossary

Definitions of financial and protocol terms used throughout StellarKraal.

---

## A

### APR (Annual Percentage Rate)
The annualized cost of borrowing, expressed as a percentage. In StellarKraal, the APR is determined by the [interest rate model](protocol/interest-rate-model.md), which uses a jump-rate curve with a kink. See also [Interest Rate](#interest-rate), [Origination Fee](#origination-fee).

### Appraisal
The estimated market value of livestock used as collateral. Appraisals are performed off-chain and recorded when collateral is registered. The appraisal value determines how much can be borrowed against an animal. See also [Collateral](#collateral), [LTV](#ltv-loan-to-value).

### At-Risk
A loan status indicating the health factor has fallen below the warning threshold but above the liquidation threshold. The loan is still active but flagged for monitoring. See also [Health Factor](#health-factor), [Liquidation](#liquidation).

## B

### Basis Points (bps)
A unit equal to 0.01 %. Used throughout StellarKraal to represent thresholds and rates without floating-point ambiguity. For example, a liquidation threshold of 8000 bps means 80 %. See also [Liquidation Threshold](#liquidation-threshold).

### Borrower
A user who pledges livestock as collateral and receives a loan against its appraised value. The borrower is responsible for repayment and monitoring their [Health Factor](#health-factor).

## C

### Close Factor
The maximum portion of a loan's outstanding balance that can be repaid in a single liquidation event, expressed as a basis point (e.g., 5000 = 50%). This prevents a single liquidator from taking over the entire position. See also [Liquidation](#liquidation).

### Collateral
Assets pledged by a borrower to secure a loan. In StellarKraal, collateral is livestock registered on-chain. If the borrower defaults, the collateral can be seized through [Liquidation](#liquidation). See also [Appraisal](#appraisal).

### Collateralization Ratio
The ratio between the value of your collateral and your outstanding loan. A higher ratio means a safer loan position. Calculated as `collateral_value / outstanding_balance`. See also [Health Factor](#health-factor), [LTV](#ltv-loan-to-value).

### Collateral Lock
The on-chain mechanism that prevents registered collateral from being used in multiple loans simultaneously. Once a loan is [Repaid](#repayment) or [Liquidated](#liquidation), the collateral is released. See also [Collateral](#collateral).

### Contract ID
The unique identifier of the deployed Soroban smart contract on the Stellar network. Required for the backend and frontend to interact with the on-chain loan logic. See also [Soroban](#soroban).

## D

### Disbursement
The transfer of loan funds from the protocol to the borrower's wallet, triggered when a loan request is confirmed on-chain. The disbursed amount equals the loan amount minus the [Origination Fee](#origination-fee).

## E

### ECS (Elastic Container Service)
The AWS service used to run StellarKraal's backend and frontend containers. The backend runs as a Fargate task in the `stellarkraal-<env>` cluster. See also [Fargate](#fargate).

### Event-Driven Architecture
A design pattern where components communicate by emitting and consuming events rather than calling each other directly. The StellarKraal backend emits loan lifecycle events (e.g., `LoanActivated`, `LoanLiquidated`) via webhooks and the contract event listener. See also [ADR-010](adr/ADR-010-event-driven-architecture.md).

## F

### Fargate
AWS's serverless container runtime. StellarKraal's ECS tasks run on Fargate, meaning there are no EC2 instances to manage. The CPU and memory limits are set in the ECS task definition. See also [ECS](#ecs-elastic-container-service).

### Freighter
A Stellar wallet browser extension that allows users to sign transactions and interact with Soroban contracts from the web frontend. See also [Wallet](#wallet).

## H

### Health Factor (HF)
A numeric representation of a loan's safety. Calculated as `(collateral_value * liquidation_threshold) / outstanding_balance`, scaled by 10,000 (basis points). A value below 10,000 means the loan is eligible for [Liquidation](#liquidation). See also [Collateralization Ratio](#collateralization-ratio), [Liquidation Threshold](#liquidation-threshold).

### Horizon
The Stellar Foundation's public API server that provides a REST interface to the Stellar network. Horizon indexes ledger data and exposes endpoints for querying accounts, transactions, operations, and effects. StellarKraal's backend interacts with the network via **Soroban RPC** rather than Horizon for contract calls, but Horizon can be used to inspect raw ledger data and account state. See also [Soroban RPC](#soroban-rpc), [Testnet](#testnet).
Official docs: https://developers.stellar.org/docs/data/horizon

## I

### Interest Rate
The cost of borrowing funds, calculated using a jump-rate model with a kink. Below the kink utilization, rates are low; above the kink, rates increase steeply to encourage repayments. See also [APR](#apr-annual-percentage-rate).

### InvalidTransitionError
An error thrown by the backend [Loan State Machine](protocol/loan-state-machine.md) when an invalid loan status transition is attempted (e.g., trying to move from `repaid` back to `active`).

## J

### JWT (JSON Web Token)
A signed token used to authenticate API requests to the StellarKraal backend. The backend issues a JWT after a successful login. Clients include it in the `Authorization: Bearer <token>` header on subsequent requests. Tokens expire and must be refreshed. See also [ADR-002](adr/ADR-002-jwt-auth.md).

### Jump-Rate Model
An [interest rate](#interest-rate) model where the rate increases slowly up to a target utilization rate (the "kink"), then increases sharply beyond it. This incentivizes borrowers to maintain healthy utilization. See also [APR](#apr-annual-percentage-rate).

## L

### Ledger
A sequential block in the Stellar network that contains transactions. The [contract event listener](guides/contract-event-listener.md) tracks the last processed ledger to avoid re-processing events. Each ledger closes approximately every 5 seconds and has a unique sequence number. See also [Soroban](#soroban), [Sequence Number](#sequence-number).
Official docs: https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/ledgers

### Ledger Cursor
A pointer to the last processed ledger sequence number. The event listener persists this cursor to enable replay from the correct position after a restart. See also [Ledger](#ledger).

### Liquidation
The process of closing an under-collateralized loan by repaying the outstanding balance on behalf of the borrower and seizing the collateral. Can be partial or full. See also [Close Factor](#close-factor), [Health Factor](#health-factor), [Liquidator](#liquidator).

### Liquidation Threshold
The minimum ratio of collateral value to loan value required to keep a loan safe. Represented as a basis point (e.g., 8000 = 80%). Below this threshold, the loan becomes eligible for [Liquidation](#liquidation). See also [Health Factor](#health-factor), [LTV](#ltv-loan-to-value).

### Liquidator
A user or bot that repays an under-collateralized loan's outstanding balance in exchange for seizing the borrower's collateral. Liquidators can be whitelisted by the protocol admin. See also [Liquidation](#liquidation).

### Loan Status
The current state of a loan in the [Loan State Machine](protocol/loan-state-machine.md): `Pending`, `Active`, `At-Risk`, `Repaid`, or `Liquidated`. Terminal states are `Repaid` and `Liquidated`.

### Loan-to-Value (LTV)
The maximum percentage of collateral value that can be borrowed. For example, a 70% LTV means a borrower can receive up to 70% of the collateral's appraised value as a loan. See also [Collateral](#collateral), [Liquidation Threshold](#liquidation-threshold).

## M

### Mainnet
The live, public Stellar network where real-value transactions occur. StellarKraal's production deployment targets Mainnet. Contrast with [Testnet](#testnet), which uses valueless test lumens and resets periodically. Always verify `NEXT_PUBLIC_NETWORK=mainnet` in production environment variables before deploying contracts.
Official docs: https://developers.stellar.org/docs/learn/fundamentals/networks

### Multi-Oracle Median
A price feed mechanism that aggregates prices from multiple oracle sources and takes the median value. This reduces the impact of any single oracle failure or manipulation. See also [TWAP](#twap-time-weighted-average-price).

## N

### N+1 Query Problem
A database performance issue where code fetches a list of N records and then issues one additional query per record instead of a single bulk query. This appears as a linear increase in response time as the dataset grows. See the [Performance Tuning Guide](performance-tuning.md) for how to detect and fix it.

## O

### Oracle
An external data provider that supplies price information to the smart contract. StellarKraal uses a [multi-oracle median](#multi-oracle-median) design for price resilience. See also [TWAP](#twap-time-weighted-average-price).

### Origination Fee
A one-time fee charged when a loan is created, deducted from the [Disbursement](#disbursement). Typically expressed as a percentage of the loan amount.

### Outstanding Balance
The remaining amount owed on a loan, including principal and accrued interest. When this reaches zero, the loan is fully [Repaid](#repayment).

## P

### Pending
An off-chain loan state before the `request_loan` transaction is confirmed on-chain. The loan exists in the backend database but not yet on the Soroban contract. See also [Loan Status](#loan-status).

### Polling Interval
The time between successive checks for new contract events by the [contract event listener](guides/contract-event-listener.md). Configurable via the `EVENT_POLL_INTERVAL_MS` environment variable (default: 5000ms).

## R

### Repayment
The act of paying back part or all of a loan's [Outstanding Balance](#outstanding-balance). Partial repayments reduce the balance but keep the loan active; full repayment moves the loan to the terminal `Repaid` state.

### RPC (Remote Procedure Call)
The Soroban JSON-RPC endpoint used by the backend to query contract state, submit transactions, and listen for contract events. Configured via `RPC_URL`.

## S

### SAC (Stellar Asset Contract)
A Soroban smart contract that wraps a classic Stellar asset so it can be used within the Soroban contract environment. StellarKraal uses a SAC to represent the loan disbursement token on-chain. See also [Soroban](#soroban).

### Sequence Number
A monotonically increasing counter on every Stellar account, incremented by one each time the account submits a transaction. The Soroban RPC requires the correct sequence number when building transactions; a mismatch results in a `bad_seq` error. The troubleshooting guide covers how to resolve sequence number mismatches caused by concurrent transaction submission. See also [Ledger](#ledger), [Soroban RPC](#soroban-rpc).
Official docs: https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/accounts#sequence-number

### Soroban
Stellar's smart contract platform that runs WebAssembly (WASM) contracts. StellarKraal's loan lifecycle is managed by a Soroban contract written in Rust. See also [Contract ID](#contract-id), [WASM](#wasm-webassembly), [Soroban RPC](#soroban-rpc).
Official docs: https://developers.stellar.org/docs/build/smart-contracts/overview

### Soroban RPC
The JSON-RPC 2.0 server that provides access to the Soroban contract execution environment. The StellarKraal backend sends all contract invocations and event queries through the Soroban RPC endpoint (configured via `RPC_URL`). It differs from [Horizon](#horizon) in that it exposes contract-specific operations such as `simulateTransaction`, `sendTransaction`, and `getEvents`. See also [RPC](#rpc-remote-procedure-call), [Horizon](#horizon).
Official docs: https://developers.stellar.org/docs/data/rpc

## T

### Testnet
Stellar's public test network, used for development and staging. Test lumens (XLM) have no real value and can be obtained for free from the Stellar Friendbot faucet. The Testnet resets periodically (roughly once per quarter), which removes all deployed contracts and accounts. StellarKraal's local development and CI pipelines target Testnet via `NEXT_PUBLIC_NETWORK=testnet`. Contrast with [Mainnet](#mainnet).
Official docs: https://developers.stellar.org/docs/learn/fundamentals/networks

### TWAP (Time-Weighted Average Price)
A price feed mechanism that averages oracle prices over a time window, reducing the impact of short-term price volatility. Used for [Liquidation](#liquidation) price calculations. See also [Oracle](#oracle), [Multi-Oracle Median](#multi-oracle-median).

### TransitionRecord
A record of a loan status change in the backend, containing `from`, `to`, and `at` (ISO timestamp). Stored in the loan's [Transition History](#transition-history). See also [Loan State Machine](protocol/loan-state-machine.md).

### Transition History
An ordered list of [TransitionRecords](#transitionrecord) tracking every status change a loan has undergone, used for auditing and debugging.

## U

### Utilization Rate
The ratio of total outstanding loans to total available liquidity. In the jump-rate model, this determines the current [Interest Rate](#interest-rate).

## W

### WASM (WebAssembly)
A portable binary instruction format that Soroban uses to execute smart contracts. When you build the StellarKraal Rust contract (`cargo build --target wasm32-unknown-unknown --release`), the output is a `.wasm` file that is uploaded to the Stellar network. The WASM module is stored on-chain and executed by the Soroban VM for every contract invocation. See also [Soroban](#soroban), [Contract ID](#contract-id).
Official docs: https://webassembly.org/

### WAL (Write-Ahead Log)
A SQLite journal mode that improves read/write concurrency. With WAL enabled, readers do not block writers and writers do not block readers. StellarKraal enables WAL mode automatically during database migrations. Verify with `PRAGMA journal_mode;` — the expected result is `wal`. See also [Performance Tuning Guide](performance-tuning.md).

### Wallet
A Stellar account used to hold funds and sign transactions. StellarKraal integrates with [Freighter](#freighter) for browser-based wallet access.

### Whitelist
An access control mechanism that restricts which addresses can perform [Liquidation](#liquidation). When the liquidator whitelist is empty, the protocol operates in open mode (anyone can liquidate).

## X

### XDR (External Data Representation)
The binary encoding format used by the Stellar network to serialize transactions and ledger entries. When the backend builds a loan transaction, it encodes it as XDR before sending it to the Soroban RPC endpoint. XDR serialization is one of the common CPU bottlenecks identified during profiling. See also [Soroban](#soroban), [RPC](#rpc-remote-procedure-call).
Official docs: https://developers.stellar.org/docs/learn/encyclopedia/data-format/xdr

## Z

### Zero-Knowledge Proof (ZKP)
Not currently used in StellarKraal, but referenced in ADR-009 as a possible future privacy mechanism for collateral appraisal values. Included here for contributors evaluating the API v2 design direction. See also [ADR-009](adr/ADR-009-api-v2-design.md).

---

## See Also

- [Loan State Machine](protocol/loan-state-machine.md)
- [Liquidation Mechanism](protocol/liquidation.md)
- [Interest Rate Model](protocol/interest-rate-model.md)
- [Contract Events Reference](protocol/events.md)
- [Smart Contract Interface](contracts/stellarkraal-interface.md)
