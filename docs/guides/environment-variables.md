# Environment Variables

This guide documents every environment variable used by StellarKraal. Copy `.env.example` to `.env` and fill in the values before starting any service.

```bash
cp .env.example .env
```

Variables marked **Required** must be set or the service will refuse to start. Variables marked **Optional** have safe defaults that work for local development.

> **Security note:** Never commit real secrets to version control. Variables marked with a GitHub Secret name must be stored in GitHub Actions (Settings → Secrets and variables → Actions) for CI/CD.

---

## Shared

These variables are consumed by both the frontend build and the backend runtime.

### `NEXT_PUBLIC_NETWORK`

| | |
|---|---|
| Required | Yes |
| Format | `testnet` \| `mainnet` |
| Default | `testnet` |
| GitHub Secret | `NEXT_PUBLIC_NETWORK` |

Selects the Stellar network. Use `testnet` for all non-production environments. Changing this to `mainnet` without updating `RPC_URL` and `CONTRACT_ID` to matching production values will cause all contract calls to fail.

### `RPC_URL`

| | |
|---|---|
| Required | Yes |
| Format | HTTPS URL |
| Example | `https://soroban-testnet.stellar.org` |
| GitHub Secret | `RPC_URL` |

Soroban JSON-RPC endpoint the backend uses to submit transactions and query contract state. The public testnet endpoint is `https://soroban-testnet.stellar.org`. For mainnet use `https://soroban-mainnet.stellar.org` or a private RPC provider.

### `CONTRACT_ID`

| | |
|---|---|
| Required | Yes |
| Format | 56-character Stellar contract/account ID (`C...`) |
| GitHub Secret | `CONTRACT_ID` |

The deployed Soroban contract address. Obtain this after running `stellar contract deploy`. A mismatch between this value and the actual on-chain deployment will cause all loan lifecycle operations to fail silently or with cryptic RPC errors.

### `HORIZON_URL`

| | |
|---|---|
| Required | No |
| Format | HTTPS URL |
| Default | `https://horizon-testnet.stellar.org` |

Stellar Horizon API URL used as a fallback for account balance reads when the Soroban RPC endpoint is unavailable. Optional — when unset the backend uses the public Horizon endpoint for the configured network. Override this if you need to point at a private or local Horizon instance.

---

## Frontend

These variables are embedded into the Next.js bundle at build time. Any change requires a rebuild (`npm run build`).

### `NEXT_PUBLIC_API_URL`

| | |
|---|---|
| Required | Yes |
| Format | HTTP(S) URL, no trailing slash |
| Default (local) | `http://localhost:3001` |
| GitHub Secret | `NEXT_PUBLIC_API_URL` |

Base URL the browser uses to reach the backend REST API. In production this must be the public HTTPS URL of the backend service. An incorrect value causes all API calls from the frontend to fail with network errors.

### `NEXT_PUBLIC_RPC_URL`

| | |
|---|---|
| Required | Yes |
| Format | HTTPS URL |
| Default (local) | `https://soroban-testnet.stellar.org` |
| GitHub Secret | `NEXT_PUBLIC_RPC_URL` |

Soroban RPC URL used by the browser-side Stellar SDK (e.g. Freighter wallet integration). Usually the same value as `RPC_URL`. Exposed to the browser, so do not use a private RPC endpoint that carries credentials in the URL.

---

## Backend

These variables are read at runtime by the Express API server (`backend/src/config.ts`). The server validates all required variables on startup using Zod and exits with a descriptive error if any are missing or malformed.

### `PORT`

| | |
|---|---|
| Required | No |
| Format | Integer 1–65535 |
| Default | `3001` |

TCP port the Express server listens on. Change this if port 3001 is already in use on your machine. The Docker Compose file maps this port to the host automatically.

### `NODE_ENV`

| | |
|---|---|
| Required | No |
| Format | `development` \| `production` \| `test` |
| Default | `development` |

Controls logging verbosity, error detail in API responses, and certain security defaults. Always set to `production` in deployed environments — this disables stack traces in error responses and enables stricter security headers.

### `FRONTEND_URL`

| | |
|---|---|
| Required | In production |
| Format | HTTP(S) URL, no trailing slash |
| Default (local) | `http://localhost:3000` |
| GitHub Secret | `FRONTEND_URL` |

Allowed CORS origin. The backend rejects cross-origin requests from any other origin. In production set this to the exact URL of the deployed frontend (e.g. `https://app.stellarkraal.example.com`).

### `JWT_SECRET`

| | |
|---|---|
| Required | In production |
| Format | Arbitrary string, minimum 32 characters recommended |
| GitHub Secret | `JWT_SECRET` |

Secret used to sign and verify JWT access tokens. A weak or default value allows anyone to forge valid tokens. Generate a strong value with:

```bash
openssl rand -hex 32
```

Rotate this secret by updating the value and redeploying — all existing tokens will be immediately invalidated.

### `ACCESS_TTL_MS`

| | |
|---|---|
| Required | No |
| Format | Positive integer (milliseconds) |
| Default | `900000` (15 minutes) |

Time-to-live for JWT access tokens. Access tokens are short-lived and must be refreshed via `/api/v1/auth/refresh` before expiry. Set this lower (e.g., `300000` for 5 minutes) for tighter security; set it higher (e.g., `3600000` for 1 hour) for better UX in low-risk environments.

### `REFRESH_TTL_MS`

| | |
|---|---|
| Required | No |
| Format | Positive integer (milliseconds) |
| Default | `604800000` (7 days) |

Time-to-live for refresh tokens. Refresh tokens are stored as HTTP-only cookies and can be used to obtain new access tokens without re-authenticating. Set this to a shorter duration (e.g., `86400000` for 1 day) if you need tighter session control.

### `HEALTH_FACTOR_WARN`

| | |
|---|---|
| Required | No |
| Format | Positive integer (×10_000) |
| Default | `13000` (1.3) |

Health factor threshold below which a warning-level alert is fired. The health factor is calculated as `(collateral_value × liquidation_threshold_bps) / (loan_amount × 10_000)`. A health factor of 1.3 means the loan is 30% overcollateralized. When it drops below this threshold, a warning is sent to Slack and the on-call team to give the borrower time to add collateral or repay.

### `HEALTH_FACTOR_CRIT`

| | |
|---|---|
| Required | No |
| Format | Positive integer (×10_000) |
| Default | `10000` (1.0) |

Critical health factor threshold below which a loan becomes eligible for liquidation. A health factor of 1.0 means the loan is exactly at the liquidation boundary. When it drops below this value, a critical alert is sent to PagerDuty and the liquidation bot should trigger liquidation.

### `WEBHOOK_SECRET`

| | |
|---|---|
| Required | No |
| Format | Hex or arbitrary string, minimum 16 characters |
| GitHub Secret | `WEBHOOK_SECRET` |

HMAC-SHA256 secret used to verify the signature on incoming webhook payloads. If unset, webhook signature verification is skipped (not recommended in production). Generate with:

```bash
openssl rand -hex 32
```

### `ADMIN_API_KEY`

| | |
|---|---|
| Required | No |
| Format | Arbitrary string, minimum 8 characters |
| GitHub Secret | `ADMIN_API_KEY` |

Bearer token required to access `/api/admin/*` endpoints. If unset, admin routes return 403. Rotate immediately if compromised. Generate with:

```bash
openssl rand -hex 16
```

### Rate Limiting

All rate limits are expressed as **requests per minute per IP address**.

| Variable | Default | Description |
|---|---|---|
| `RATE_LIMIT_GLOBAL` | `60` | Applied to every route as a baseline ceiling |
| `RATE_LIMIT_AUTH` | `10` | Applied to `/auth/*` routes to slow brute-force attempts |
| `RATE_LIMIT_READ` | `100` | Applied to read-only GET routes |
| `RATE_LIMIT_WRITE` | `10` | Applied to state-changing POST/PUT/DELETE routes |

Increase these values if legitimate traffic is being throttled. Decrease them for tighter abuse protection in production.

### Request Timeouts

| Variable | Default | Description |
|---|---|---|
| `TIMEOUT_GLOBAL_MS` | `30000` | Maximum milliseconds for any request before a 408 is returned |
| `TIMEOUT_WRITE_MS` | `15000` | Maximum milliseconds for write operations (loan origination, collateral updates) |
| `TIMEOUT_CONTRACT_MS` | `30000` | Maximum milliseconds for Soroban contract submission routes (loan request, repay, liquidate) |

Values are in milliseconds. `TIMEOUT_CONTRACT_MS` is deliberately higher than `TIMEOUT_WRITE_MS` to account for Soroban RPC latency. Increase it if contract submissions are timing out on your network.

### RPC Connection Pool

| Variable | Default | Description |
|---|---|---|
| `POOL_MIN` | `2` | Minimum persistent RPC connections to keep open |
| `POOL_MAX` | `10` | Maximum concurrent RPC connections |

`POOL_MIN` must be ≤ `POOL_MAX`. Increase `POOL_MAX` under high write load; decrease it to reduce resource usage on low-traffic deployments.

### `APPRAISAL_CACHE_TTL_MS`

| | |
|---|---|
| Required | No |
| Format | Positive integer (milliseconds) |
| Default | `300000` (5 minutes) |

How long collateral appraisal results are cached in memory before a fresh RPC call is made. Increase this to reduce RPC traffic; decrease it if you need near-real-time price accuracy for liquidation decisions.

### `ORIG_FEE_BPS`

| | |
|---|---|
| Required | No |
| Format | Positive integer (basis points) |
| Default | `50` (0.5%) |

Origination fee charged on each new loan, expressed in basis points. 50 bps = 0.5%. The contract enforces a hard maximum of 500 bps (5%); setting a higher value will cause the contract to return error #10. Change this with the admin function `set_origination_fee(admin, fee_bps)` on the contract — the backend reads it from config on startup only for display/validation purposes.

### `SHUTDOWN_TIMEOUT_MS`

| | |
|---|---|
| Required | No |
| Format | Positive integer (milliseconds), minimum 1000 |
| Default | `10000` (10 seconds) |

Maximum time the server waits for in-flight requests to complete after receiving `SIGTERM` or `SIGINT`. During this window the server stops accepting new connections but continues serving existing requests. After this timeout, the process exits forcefully. Set this higher (e.g., `30000`) if your Soroban contract calls typically take longer than 10 seconds under load.

### `AUDIT_LOG_DIR`

| | |
|---|---|
| Required | No |
| Format | Absolute or relative filesystem path |
| Default | — (audit logging disabled when unset) |

Directory where structured audit log files are written. Each audit event (admin actions, loan state changes, authentication events) is appended as a JSON line. Ensure the backend process has write access to this directory. In production, use an absolute path (e.g., `/var/log/stellarkraal/audit`).

### Logging

These variables control the application logger. All are optional with safe defaults.

| Variable | Default | Description |
|---|---|---|
| `LOG_LEVEL` | `info` | Minimum log severity to emit: `debug`, `info`, `warn`, or `error`. Use `debug` when troubleshooting; keep `info` or higher in production to reduce noise. |
| `LOG_MAX_SIZE` | `10m` | Maximum size of a single log file before rotation (e.g., `10m`, `100m`). |
| `LOG_MAX_FILES` | `7` | Number of rotated log files to retain before the oldest is deleted. A value of `7` gives 7-day retention for daily rotation. |

### `METRICS_TOKEN`

| | |
|---|---|
| Required | No |
| Format | Arbitrary string |
| GitHub Secret | `METRICS_TOKEN` |

Bearer token required to access the Prometheus `/metrics` endpoint on the backend. When unset, `/metrics` is unauthenticated — acceptable for local development, but always set this in production. Generate with:

```bash
openssl rand -hex 32
```

Scrape configs in Prometheus must include `Authorization: Bearer <token>` when this is set.

### `DATABASE_URL`

| | |
|---|---|
| Required | No (production: recommended) |
| Format | `postgresql://user:password@host:5432/dbname` or `sqlite:/path/to/db` |
| GitHub Secret | `DATABASE_URL` |

PostgreSQL connection URL for staging and production. When unset, the backend falls back to SQLite (local development only). In production, always set this to a PostgreSQL URL. The value must start with `postgres://`, `postgresql://`, or `sqlite:`.

---

## Alerting

These variables configure the backend alert dispatcher. All are optional — the corresponding alert channel is silently disabled if the variable is unset.

### `SLACK_WEBHOOK_URL`

| | |
|---|---|
| Required | No |
| Format | `https://hooks.slack.com/services/T.../B.../...` |
| GitHub Secret | `SLACK_WEBHOOK_URL` |

Slack incoming webhook URL for deployment notifications and operational alerts. Create one at <https://api.slack.com/messaging/webhooks>. The same webhook is used by the staging deployment workflow.

### `PAGERDUTY_ROUTING_KEY`

| | |
|---|---|
| Required | No |
| Format | 32-character alphanumeric string |
| GitHub Secret | `PAGERDUTY_ROUTING_KEY` |

PagerDuty Events API v2 routing (integration) key. Only critical-severity alerts (e.g. liquidation failures, RPC outages) are sent to PagerDuty. Find this key in PagerDuty under Services → Integrations → Events API v2.

### `RUNBOOK_BASE_URL`

| | |
|---|---|
| Required | No |
| Format | HTTPS URL, no trailing slash |
| Default | `https://github.com/teslims2/StellarKraal-/blob/main/docs/runbooks` |

Base URL prepended to runbook paths in alert messages. Override this if you host runbooks elsewhere (e.g. Confluence, Notion).

---

## Docker

These variables are used exclusively by Docker Compose services (Grafana and staging overrides). They are not read by `backend/src/config.ts`. Add them to your `.env` file when running the Docker Compose stack.

### Grafana

`docker-compose.prod.yml` passes the `.env` file to the Grafana container, so these variables must be set in `.env` before starting the prod stack.

### `GF_SECURITY_ADMIN_USER`

| | |
|---|---|
| Required | No |
| Format | Non-empty string |
| Default | `admin` |
| GitHub Secret | `GF_SECURITY_ADMIN_USER` |

Grafana admin username. Used to log in to the Grafana UI at `/login`. Change from the default in all non-local environments.

### `GF_SECURITY_ADMIN_PASSWORD`

| | |
|---|---|
| Required | In production |
| Format | Non-empty string, minimum 8 characters recommended |
| GitHub Secret | `GF_SECURITY_ADMIN_PASSWORD` |

Grafana admin password. Never leave this as the default value in any environment reachable from the internet. Generate with:

```bash
openssl rand -hex 16
```

### `GF_AUTH_ANONYMOUS_ENABLED`

| | |
|---|---|
| Required | No |
| Format | `true` \| `false` |
| Default | `true` (local dev) |

Allows unauthenticated read-only access to Grafana dashboards. Set to `false` in production to require login. The base `docker-compose.yml` hardcodes `true` for convenience; override with `false` via `.env` in production.

### `GF_AUTH_ANONYMOUS_ORG_ROLE`

| | |
|---|---|
| Required | No |
| Format | `Viewer` \| `Editor` \| `Admin` |
| Default | `Viewer` |

Role granted to anonymous users when `GF_AUTH_ANONYMOUS_ENABLED=true`. Keep this as `Viewer` — granting `Editor` or `Admin` to anonymous users is a security risk.

---

### Staging overrides

These variables are consumed by `docker-compose.staging.yml` when running the staging stack:

```bash
docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d
```

Store them as GitHub Actions environment secrets under the `staging` environment (Settings → Environments → staging).

### `STAGING_RPC_URL`

| | |
|---|---|
| Required | For staging |
| Format | HTTPS URL |
| Default | `https://soroban-testnet.stellar.org` |
| GitHub Secret | `STAGING_RPC_URL` |

Soroban RPC endpoint used by the staging backend and frontend. Overrides `RPC_URL` in the staging Compose override.

### `STAGING_CONTRACT_ID`

| | |
|---|---|
| Required | For staging |
| Format | 56-character Stellar contract/account ID |
| GitHub Secret | `STAGING_CONTRACT_ID` |

Soroban contract address for the staging deployment. Must match the contract deployed against the staging RPC endpoint. Overrides `CONTRACT_ID` in the staging Compose override.

### `STAGING_API_URL`

| | |
|---|---|
| Required | For staging |
| Format | HTTPS URL, no trailing slash |
| Default | `https://api-staging.stellarkraal.example.com` |
| GitHub Secret | `STAGING_API_URL` |

Public base URL of the staging backend API. Used by the staging frontend as `NEXT_PUBLIC_API_URL`. Overrides `NEXT_PUBLIC_API_URL` in the staging Compose override.

### `STAGING_FRONTEND_URL`

| | |
|---|---|
| Required | For staging |
| Format | HTTPS URL, no trailing slash |
| Default | `https://staging.stellarkraal.example.com` |
| GitHub Secret | `STAGING_FRONTEND_URL` |

Staging frontend URL used to configure CORS on the staging backend. Overrides `FRONTEND_URL` in the staging Compose override.

---

## Quick-reference table

| Variable | Service | Required | Default |
|---|---|---|---|
| `NEXT_PUBLIC_NETWORK` | Shared | Yes | `testnet` |
| `RPC_URL` | Shared | Yes | — |
| `CONTRACT_ID` | Shared | Yes | — |
| `HORIZON_URL` | Shared | No | (public Horizon) |
| `NEXT_PUBLIC_API_URL` | Frontend | Yes | `http://localhost:3001` |
| `NEXT_PUBLIC_RPC_URL` | Frontend | Yes | `https://soroban-testnet.stellar.org` |
| `PORT` | Backend | No | `3001` |
| `NODE_ENV` | Backend | No | `development` |
| `FRONTEND_URL` | Backend | Prod only | `http://localhost:3000` |
| `ALLOWED_ORIGINS` | Backend | No | — |
| `JWT_SECRET` | Backend | Prod only | — |
| `ACCESS_TTL_MS` | Backend | No | `900000` |
| `REFRESH_TTL_MS` | Backend | No | `604800000` |
| `WEBHOOK_SECRET` | Backend | No | — |
| `ADMIN_API_KEY` | Backend | No | — |
| `RATE_LIMIT_GLOBAL` | Backend | No | `60` |
| `RATE_LIMIT_AUTH` | Backend | No | `10` |
| `RATE_LIMIT_READ` | Backend | No | `100` |
| `RATE_LIMIT_WRITE` | Backend | No | `10` |
| `TIMEOUT_GLOBAL_MS` | Backend | No | `30000` |
| `TIMEOUT_WRITE_MS` | Backend | No | `15000` |
| `TIMEOUT_CONTRACT_MS` | Backend | No | `30000` |
| `ORIG_FEE_BPS` | Backend | No | `50` |
| `POOL_MIN` | Backend | No | `2` |
| `POOL_MAX` | Backend | No | `10` |
| `APPRAISAL_CACHE_TTL_MS` | Backend | No | `300000` |
| `HEALTH_FACTOR_WARN` | Backend | No | `13000` |
| `HEALTH_FACTOR_CRIT` | Backend | No | `10000` |
| `SHUTDOWN_TIMEOUT_MS` | Backend | No | `10000` |
| `AUDIT_LOG_DIR` | Backend | No | — |
| `LOG_LEVEL` | Backend | No | `info` |
| `LOG_MAX_SIZE` | Backend | No | `10m` |
| `LOG_MAX_FILES` | Backend | No | `7` |
| `METRICS_TOKEN` | Backend | Prod recommended | — |
| `DATABASE_URL` | Backend | Prod only | — (SQLite) |
| `SLACK_WEBHOOK_URL` | Alerting | No | — |
| `PAGERDUTY_ROUTING_KEY` | Alerting | No | — |
| `RUNBOOK_BASE_URL` | Alerting | No | (GitHub URL) |
| `GF_SECURITY_ADMIN_USER` | Docker/Grafana | No | `admin` |
| `GF_SECURITY_ADMIN_PASSWORD` | Docker/Grafana | Prod only | — |
| `GF_AUTH_ANONYMOUS_ENABLED` | Docker/Grafana | No | `true` |
| `GF_AUTH_ANONYMOUS_ORG_ROLE` | Docker/Grafana | No | `Viewer` |
| `STAGING_RPC_URL` | Docker/Staging | Staging only | (testnet RPC) |
| `STAGING_CONTRACT_ID` | Docker/Staging | Staging only | — |
| `STAGING_API_URL` | Docker/Staging | Staging only | (staging URL) |
| `STAGING_FRONTEND_URL` | Docker/Staging | Staging only | (staging URL) |
