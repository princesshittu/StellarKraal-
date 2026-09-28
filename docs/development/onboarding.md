# Developer Onboarding Guide

Welcome to StellarKraal! This guide will take you from zero to submitting your
first pull request. It covers the repo layout, key files, how the CI/CD
pipeline works, and where to find things.

> **Time to first PR:** ~2 hours after completing setup.

---

## Quick-Start Checklist

Use this checklist to go from a fresh machine to your first open PR in under 2 hours.
Tick each step as you complete it. Detailed instructions for each step are in the
sections below (links provided).

### Prerequisites (~15 min)

- [ ] **Install Node.js 20+** (`node --version` shows `v20.x` or higher).
  → [nodejs.org](https://nodejs.org/) or `nvm install 20` ([local-setup.md](local-setup.md))
- [ ] **Install Rust 1.78+** (`rustc --version`).
  → `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- [ ] **Install stellar-cli 22+** (`stellar --version`).
  → `cargo install --locked stellar-cli --features opt`
- [ ] **Install Docker & Docker Compose 24+** (optional, for the full stack).
  → [docs.docker.com](https://docs.docker.com/get-docker/)
- [ ] **Install the [Freighter](https://www.freighter.app/) browser extension** (needed for
  wallet flows; optional for backend-only work).

### Fork and clone (~5 min)

- [ ] **Fork** the repo on GitHub: `https://github.com/teslims2/StellarKraal-`
- [ ] **Clone your fork** and add the upstream remote:
  ```bash
  git clone https://github.com/<your-username>/StellarKraal-.git
  cd StellarKraal-
  git remote add upstream https://github.com/teslims2/StellarKraal-.git
  ```
- [ ] **Copy the env file:**
  ```bash
  cp env.example .env
  ```
  Open `.env` and fill in at minimum `CONTRACT_ID` and `JWT_SECRET`.
  → [Environment Variables section](#5-environment-variables)

### Install dependencies and run the backend (~10 min)

- [ ] **Install backend dependencies:**
  ```bash
  cd backend && npm install
  ```
- [ ] **Run database migrations:**
  ```bash
  npm run migrate:dev
  ```
- [ ] **Start the backend dev server:**
  ```bash
  npm run dev
  ```
  Confirm you see `Server listening on port 3001` in the terminal.
- [ ] **Smoke test:**
  ```bash
  curl http://localhost:3001/api/health
  # Expected: {"status":"healthy",...}
  ```

### Install dependencies and run the frontend (~5 min)

- [ ] **Open a second terminal.** Install frontend dependencies and start the dev server:
  ```bash
  cd frontend && npm install && npm run dev
  ```
- [ ] Open `http://localhost:3000` in your browser and confirm the app loads.

### Run the test suites (~15 min)

- [ ] **Backend unit tests** (must pass locally before opening a PR):
  ```bash
  cd backend && npm test
  ```
- [ ] **Frontend unit tests:**
  ```bash
  cd frontend && npm run test
  ```
- [ ] **Smart contract tests** (requires Rust toolchain):
  ```bash
  cd contracts/stellarkraal && cargo test
  ```
  → [Running Tests section](#7-running-tests)

### Make a small change (~15 min)

- [ ] **Create a branch from `main`:**
  ```bash
  git checkout main && git pull upstream main
  git checkout -b docs/onboarding-test-<your-github-handle>
  ```
- [ ] **Make a trivial change** — for example, fix a typo in any file under `docs/` or add a
  comment to `backend/src/config.ts`. Keep the change small and self-contained.
- [ ] **Commit using Conventional Commits format:**
  ```bash
  git add <changed-file>
  git commit -m "docs: fix typo in onboarding guide"
  ```
  → [Commit Convention section](#9-commit-convention)

### Open a PR (~5 min)

- [ ] **Push your branch:**
  ```bash
  git push -u origin docs/onboarding-test-<your-github-handle>
  ```
- [ ] **Open a pull request** on GitHub against `teslims2/StellarKraal-` `main`. Fill in the
  PR template (title, description, checklist).
- [ ] **Confirm CI is green** — about 15 workflows trigger in parallel. Wait for the required
  checks (`backend-ci`, `frontend-ci`, `contracts-ci`, `secret-scan`) to pass.
  → [CI/CD Pipeline section](#8-cicd-pipeline)

---

> **Estimated total time:** ~70 minutes (prerequisites may take longer on a fresh machine).
> If you get stuck, check [`docs/troubleshooting.md`](../troubleshooting.md) or open a
> [GitHub issue](https://github.com/teslims2/StellarKraal-/issues).

---

---

## 1. Repository Structure

```
StellarKraal-/
├── backend/          # Node.js + TypeScript + Express API
├── frontend/         # Next.js 14 + Tailwind CSS app
├── contracts/        # Rust / Soroban smart contract
├── docs/             # Project documentation
├── grafana/          # Grafana dashboard JSON files
├── observability/    # Promtail, Grafana datasource/dashboard provisioning
├── infrastructure/   # Terraform IaC definitions
├── scripts/          # Shared build/CI helper scripts
├── __tests__/        # Root-level integration tests
├── tests/            # Shared test utilities
├── terraform/        # Additional Terraform modules
├── docker-compose.yml           # Local dev stack
├── docker-compose.staging.yml   # Staging overlay
├── docker-compose.prod.yml      # Production overlay
├── docker-compose.test.yml      # CI/E2E test overlay
├── .github/workflows/           # 26 CI/CD workflow files
├── CONTRIBUTING.md   # Commit conventions, branching, release process
├── SECURITY.md       # Vulnerability disclosure policy
├── CHANGELOG.md      # Auto-generated by release-please
└── README.md         # Project overview and quick links
```

### What lives where

| Directory | Contains | Key entry point |
|-----------|----------|-----------------|
| `backend/src/` | Express app, routes, middleware, services, DB, utils | `index.ts` (main app) |
| `frontend/src/` | React components, pages, API client | `app/page.tsx` |
| `contracts/stellarkraal/` | Rust Soroban contract | `src/lib.rs` |
| `docs/` | Protocol specs, guides, ADRs, runbooks | `docs/observability.md`, `docs/troubleshooting.md` |
| `grafana/dashboards/` | Grafana dashboard JSON | `backend.json`, `logs.json` |
| `observability/` | Promtail + Grafana provisioning configs | `promtail-config.yml` |

---

## 2. Backend Deep Dive

### Directory layout

```
backend/src/
├── index.ts              # Main Express app (middleware stack, routes, error handler)
├── config.ts             # Zod-validated environment variables
├── metrics.ts            # Prometheus metrics (prom-client registry)
├── webhooks.ts           # Webhook registration and delivery
├── loanStateMachine.ts   # Loan state transitions
├── interestRate.ts       # Interest rate calculation
├── contractEventListener.ts  # On-chain event listener
├── routes/
│   ├── v1.ts             # Versioned API router (all v1 endpoints)
│   ├── v2.ts             # v2 stub (returns 501)
│   ├── health.ts         # Deep/readiness/liveness health probes
│   └── *.test.ts         # Route unit tests
├── middleware/
│   ├── auth.ts           # JWT auth + Stellar challenge/login flow
│   ├── errorHandler.ts   # AppError class + catch-all handler
│   ├── validate.ts       # Zod validation middleware
│   ├── rateLimit.ts      # 4 rate limiters (global, auth, read, write)
│   ├── timeout.ts        # Per-route request timeout
│   ├── idempotency.ts    # POST /loan/repay dedup
│   ├── cors.ts           # Dynamic CORS
│   ├── helmet.ts         # Security headers
│   └── audit.ts          # Audit trail logging
├── db/
│   ├── database.ts       # SQLite/PostgreSQL connection
│   ├── store.ts          # In-memory data store
│   └── migrationRunner.ts
├── services/
│   ├── collateralService.ts   # Collateral business logic
│   ├── loanService.ts         # Loan business logic
│   └── contractTx.ts          # Soroban TX builder
├── validators/
│   ├── stellar.ts        # Stellar public key Zod schema
│   └── collateral.ts     # Collateral create/update schemas
├── utils/
│   ├── logger.ts         # Winston logger with daily rotate
│   ├── rpcClient.ts      # Soroban RPC client wrapper
│   ├── connectionPool.ts # RPC connection pool + DB pool metrics
│   ├── appraisalCache.ts # In-memory appraisal cache
│   ├── alerting.ts       # Alert dispatch (Slack + PagerDuty)
│   └── alertRules.ts     # Alert rule definitions
├── jobs/
│   ├── healthFactorJob.ts      # Cron: health factor monitoring
│   └── repaymentReminderJob.ts # Cron: repayment reminders
└── cli/
    └── migrate.ts        # CLI migration helper
```

### Key files to read first

| File | Why |
|------|-----|
| `config.ts` | Understand every env var and its validation |
| `routes/v1.ts` | All API endpoints in one place |
| `middleware/auth.ts` | How JWT auth and Stellar signing work |
| `middleware/validate.ts` | How request validation is done |
| `middleware/errorHandler.ts` | The `{ error, code }` error envelope |
| `metrics.ts` | All Prometheus metrics |
| `index.ts` | The full middleware stack order |

### Running the backend

```bash
cd backend
npm install
npm run migrate:dev   # Run database migrations
npm run dev           # Start with hot-reload (ts-node-dev)
```

Backend runs on http://localhost:3001.

### Key npm scripts

| Script | What it does |
|--------|-------------|
| `npm run dev` | Start dev server with hot-reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled JS |
| `npm test` | Run all Jest tests |
| `npm run test:coverage` | Tests with coverage (excludes integration) |
| `npm run test:smoke` | Smoke tests only (fast boot check) |
| `npm run lint` | ESLint with zero-warning policy |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm run format` | Prettier format |
| `npm run migrate:dev` | Run pending migrations |
| `npm run generate:alert-rules` | Regenerate Prometheus rules from alertRules.ts |

---

## 3. Frontend Deep Dive

### Directory layout

```
frontend/src/
├── app/                # Next.js App Router pages
├── components/         # React components
├── lib/                # Utilities, API client, constants
└── __tests__/          # Jest component tests
```

### Running the frontend

```bash
cd frontend
npm install
npm run dev    # Start Next.js dev server
```

Frontend runs on http://localhost:3000.

### Key npm scripts

| Script | What it does |
|--------|-------------|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run test` | Jest component tests |
| `npm run test:contrast` | Color contrast accessibility audit |
| `npm run test:a11y` | Playwright accessibility tests |
| `npm run test:e2e` | Playwright end-to-end tests |
| `npm run type-check` | TypeScript type checking |

---

## 4. Smart Contract

The Soroban smart contract lives in `contracts/stellarkraal/`. It manages
on-chain loan lifecycle, collateral registration, and liquidation.

```bash
# Requires: Rust + stellar-cli
stellar contract build                    # Build WASM
cargo test                               # Run Rust unit tests
cargo fuzz <target> 60s                  # Run fuzz tests (requires nightly)
```

---

## 5. Environment Variables

Copy the root-level env example:

```bash
cp env.example .env
```

The minimum required for local dev:

| Variable | Default | Description |
|----------|---------|-------------|
| `RPC_URL` | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint |
| `CONTRACT_ID` | (required) | Deployed contract ID |
| `PORT` | `3001` | Backend port |
| `JWT_SECRET` | (required in prod) | JWT signing key |

All variables are validated at startup by `backend/src/config.ts` using Zod.
Missing or invalid vars cause a structured error and exit code 1.

Full reference: [`docs/guides/environment-variables.md`](../guides/environment-variables.md)

---

## 6. Docker Setup

The fastest way to run the full stack:

```bash
docker compose up --build
```

This starts:

| Service | Port | Description |
|---------|------|-------------|
| Backend | 3001 | Express API |
| Frontend | 3000 | Next.js app |
| Loki | 3100 | Log aggregation |
| Grafana | 3200 | Dashboards (anonymous viewer) |

For staging locally:

```bash
docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d
```

---

## 7. Running Tests

### Backend

```bash
cd backend
npm test                        # All unit tests
npm run test:coverage           # With coverage (70% threshold)
npm run test:smoke              # Quick smoke tests only
```

Test naming conventions:
- `*.test.ts` — unit tests
- `*.integration.test.ts` — integration tests (require DB/RPC)
- `*.edge-cases.test.ts` — edge case tests

All tests mock `@stellar/stellar-sdk`, `./utils/logger`, and `./db/store`.
Tests build isolated Express apps with `express()` + the router under test.

### Frontend

```bash
cd frontend
npm run test                    # Jest component tests
npm run test:contrast           # Accessibility contrast audit
npm run test:e2e                # Playwright end-to-end tests
```

### Smart contract

```bash
cd contracts/stellarkraal
cargo test
```

### Root-level (Docker-based)

```bash
docker compose -f docker-compose.test.yml up --build
```

---

## 8. CI/CD Pipeline

All CI runs via GitHub Actions. Here is every workflow and what it checks:

### Core build/test

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| `backend-ci.yml` | PR/push on `backend/**` | ESLint, TypeScript compile, Jest, generate alert rules, promtool validate |
| `frontend-ci.yml` | PR/push on `frontend/**` | Contrast audit, type-check, ESLint, format check, Jest, build, Lighthouse (scores 80/90+) |
| `contracts-ci.yml` | PR/push | cargo test, build WASM, verify size 100kB or less |
| `rust-ci.yml` | PR/push on `contracts/**` | cargo build, cargo test, cargo fuzz (60s) |
| `integration-tests.yml` | PR/push | Runs `*.integration.test.ts` with 60s timeout |

### Security and quality

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| `secret-scan.yml` | push/PR | Gitleaks secret scanning |
| `npm-audit.yml` | Weekly Monday + manual | npm audit (fails on high/critical) |
| `docker-security-scan.yml` | PR on Dockerfiles, weekly | Trivy CVE scan (CRITICAL = fail) |
| `openapi-check.yml` | PR on routes/services/middleware | Redocly lint openapi.json, version sync check |
| `validate-env-example.yml` | PR on config.ts/.env.example | Ensures env.example matches config.ts |
| `accessibility.yml` | push/PR to main | Jest a11y + Playwright a11y tests |

### Deployment

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| `deploy-staging.yml` | push to main | Lint+test, Docker deploy, smoke test, Slack notify |
| `deploy.yml` | push to main | Blue-green deploy (production placeholder) |
| `release-please.yml` | push to main | Auto-version bump + CHANGELOG + GitHub Release |
| `container-registry.yml` | push to main/tags | Build+push Docker images to GHCR |

### Infrastructure and monitoring

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| `terraform-check.yml` | PR/push on terraform | fmt, init, validate, TFLint |
| `terraform.yml` | PR/push on `infrastructure/**` | Full plan + apply (staging auto, prod manual gate) |
| `uptime.yml` | Every minute | Health check monitoring |
| `performance-tests.yml` | push/PR to main | Benchmark suite + PR comment with results |
| `benchmark-comparison.yml` | PR to main | Compare benchmark results vs baselines |

### What to expect when you open a PR

1. **~15 workflows trigger** in parallel. Most complete in 1-3 minutes.
2. **Required checks** (must pass to merge): backend-ci, frontend-ci, contracts-ci, secret-scan.
3. **Lighthouse** posts a score table as a PR comment.
4. **Terraform plan** posts an infrastructure diff as a PR comment (if infra files changed).
5. **Accessibility** posts contrast results as a PR comment.

---

## 9. Commit Convention

All commits **must** follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```
<type>(<scope>): <description>
```

| Type | Use for | Version bump |
|------|---------|--------------|
| `feat` | New feature | minor |
| `fix` | Bug fix | patch |
| `docs` | Documentation only | patch |
| `refactor` | Code restructuring | patch |
| `test` | Adding/fixing tests | patch |
| `chore` | Build, CI, tooling | patch |
| `perf` | Performance improvement | patch |

Examples:
```
feat(loans): add partial repayment support
fix(auth): handle expired refresh tokens gracefully
docs: expand onboarding guide for new developers
chore(ci): add OpenAPI validation workflow
```

---

## 10. Branching and PR Workflow

1. **Create a branch** from latest `main`:
   ```bash
   git checkout main && git pull
   git checkout -b feat/my-feature
   ```

2. **Make changes**, commit with conventional commits.

3. **Push and open a PR** using the PR template:
   ```bash
   git push -u origin feat/my-feature
   ```

4. **PR checklist** (from `.github/pull_request_template.md`):
   - [ ] Branch based on latest `main`
   - [ ] Commit messages follow Conventional Commits
   - [ ] Tests run locally
   - [ ] Documentation updated if needed
   - [ ] CHANGELOG updated (or release-please will handle it)

5. **Squash-merge** into `main` -- release-please auto-generates changelogs.

---

## 11. Where to Find What

| You need to... | Look at |
|-----------------|---------|
| Understand the API | `backend/src/routes/v1.ts` + `backend/openapi.json` |
| Add a new API endpoint | `backend/src/routes/v1.ts` (register route here) |
| Add request validation | `backend/src/validators/` -- create Zod schema, use `validate()` middleware |
| Understand auth flow | `backend/src/middleware/auth.ts` |
| Change error format | `backend/src/middleware/errorHandler.ts` (the `{ error, code }` envelope) |
| Add a metric | `backend/src/metrics.ts` + `backend/src/metrics.test.ts` |
| Add an alert rule | `backend/src/utils/alertRules.ts` then run `npm run generate:alert-rules` |
| Understand loan states | `docs/protocol/loan-state-machine.md` + `backend/src/loanStateMachine.ts` |
| Understand liquidation | `docs/protocol/liquidation.md` |
| Change env vars | `backend/src/config.ts` (Zod schema) + `env.example` |
| Add a migration | `backend/scripts/` then `npm run migrate:create` |
| Understand the contract | `contracts/stellarkraal/src/lib.rs` + `docs/contracts/stellarkraal-interface.md` |
| Debug a failing CI job | `.github/workflows/` -- find the workflow, read the steps |
| Add a Grafana panel | `grafana/dashboards/backend.json` or `logs.json` |
| Understand observability | `docs/observability.md` |
| Find a runbook | `docs/runbooks/` |
| Understand an ADR | `docs/adr/ADR-NNN-*.md` |

---

## 12. First Issue Suggestions

Here are good starter issues for new contributors. Each is self-contained,
low risk, and exercises a different part of the stack:

### Easy (docs and config)

1. **Improve an env var description** -- Pick a variable in `env.example` and
   expand its description. Submit a PR with `docs: clarify <var> description`.

2. **Add a LogQL query to the logs dashboard** -- Add a new panel to
   `grafana/dashboards/logs.json` for a specific use case (e.g. auth failures,
   rate-limited requests). Reference: `docs/observability.md`.

3. **Fix a typo in a doc** -- Search `docs/` for typos or outdated links.

### Medium (backend)

4. **Add a missing test** -- Check `backend/src/metrics.test.ts` or
   `backend/src/middleware/` for untested edge cases. Target 70%+ coverage.

5. **Add a description to an OpenAPI endpoint** -- Some endpoints in
   `backend/openapi.json` may still need better descriptions. Reference:
   `docs/openapi-descriptions.md`.

6. **Instrument `rpc_call_duration_seconds`** -- The metric is defined in
   `metrics.ts` but never used. Add `.observe()` calls in
   `backend/src/utils/rpcClient.ts`. Reference: `docs/observability.md`.

### Advanced (full-stack)

7. **Add a new admin endpoint** -- Implement a new `GET /admin/*` route in
   `backend/src/routes/v1.ts`, register it in `openapi.json`, add a test in
   `backend/src/routes/v1.integration.test.ts`.

8. **Add a Grafana dashboard panel** -- Create a new panel in
   `grafana/dashboards/backend.json` for a metric that isn't visualized yet.

---

## 13. Useful Links

| Resource | URL |
|----------|-----|
| Backend API docs | http://localhost:3001 (once running) |
| Grafana dashboards | http://localhost:3200 |
| Stellar docs | https://developers.stellar.org |
| Soroban docs | https://soroban.stellar.org |
| Freighter wallet | https://freighter.app |
| Project GitHub | https://github.com/teslims2/StellarKraal- |

---

## 14. Getting Help

- **Issues**: Open a [GitHub issue](https://github.com/teslims2/StellarKraal-/issues)
- **Security**: Follow `SECURITY.md` for responsible disclosure
- **Troubleshooting**: See [`docs/troubleshooting.md`](../troubleshooting.md)
- **On-call**: See [`docs/ON_CALL_ROTATION.md`](../ON_CALL_ROTATION.md)
