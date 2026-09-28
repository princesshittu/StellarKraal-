# Docker Compose Services: Dependencies and Startup Order

This document explains the service topology defined in `docker-compose.yml`, including startup order, health checks, and the optional staging overlay.

---

## Service Overview

| Service | Image / Build | Port | Purpose |
|---------|--------------|------|---------|
| `postgres` | `postgres:15-alpine` | `5432` | Relational database |
| `redis` | `redis:7-alpine` | `6379` | Cache and rate-limiting store |
| `contract-builder` | `rust:1.78` | — | Compiles the Soroban WASM contract |
| `backend` | `./backend/Dockerfile` | `3001` | Express API server |
| `frontend` | `./frontend/Dockerfile` | `3000` | Next.js frontend |
| `loki` | `grafana/loki:2.9.4` | `3100` | Log aggregation |
| `promtail` | `grafana/promtail:2.9.4` | — | Log shipper (Docker → Loki) |
| `grafana` | `grafana/grafana:10.4.2` | `3200` | Observability dashboards |

---

## Startup Order

```
postgres (health check: pg_isready)      redis (health check: redis-cli ping)
       │                                        │
       └──────────────────┬─────────────────────┘
                          │ (service_healthy)
                          ▼
                       backend   (health check: GET /health)
                          │ (service_healthy)
                          ▼
                       frontend  (health check: GET /)

contract-builder (no dependencies — runs independently)

loki             (no dependencies)
  │
  ├──► promtail  (depends_on: loki)
  └──► grafana   (depends_on: loki)
```

Key points:

- `backend` will not start until `postgres` and `redis` pass their health checks.
- `frontend` will not start until `backend` passes its health check.
- `promtail` and `grafana` both wait for `loki` to be up before starting.
- `contract-builder` is a one-shot compile step.

---

## Health Checks

### postgres

```yaml
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-postgres}"]
  interval: 10s
  timeout: 5s
  retries: 5
  start_period: 10s
```

- Checks database availability using `pg_isready`.

### redis

```yaml
healthcheck:
  test: ["CMD", "redis-cli", "ping"]
  interval: 10s
  timeout: 5s
  retries: 5
  start_period: 5s
```

- Verifies Redis server responsiveness with `redis-cli ping`.

### backend

```yaml
healthcheck:
  test: ["CMD", "wget", "-qO-", "http://localhost:3001/health"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 15s
```

- Polls `GET /health` every 30 seconds, returning 200 when ready.

### frontend

```yaml
healthcheck:
  test: ["CMD", "wget", "-qO-", "http://localhost:3000"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 20s
```

- Polls the root URL `GET /`, returning 200 when ready.

---

## Restart Policy

All services use `restart: unless-stopped`. They restart automatically after a crash but stay stopped if you explicitly run `docker compose stop` or `docker compose down`.

---

## Resource Limits

`contract-builder` is the most CPU/memory intensive service (Rust compilation). Limits are set to prevent it from starving other services:

```yaml
deploy:
  resources:
    limits:
      cpus: '1.0'
      memory: 1024M
    reservations:
      cpus: '0.25'
      memory: 256M
```

No explicit resource limits are set on `backend` or `frontend`. Add them for production deployments.

---

## Logging

`backend` and `frontend` use the `json-file` driver with a `tag` label so Promtail can filter by service:

```yaml
logging:
  driver: json-file
  options:
    tag: "backend"   # or "frontend"
```

Promtail reads from `/var/lib/docker/containers` and forwards structured JSON logs to Loki. Grafana dashboards query Loki using these tags.

---

## Staging Overlay

The staging override file (`docker-compose.staging.yml`) is layered on top of the base file:

```bash
docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d
```

The overlay replaces the RPC endpoint (`STAGING_RPC_URL`) and contract ID (`STAGING_CONTRACT_ID`) so the stack points at Stellar testnet rather than a local node. All service dependencies and health checks remain unchanged.

---

## Volumes

| Volume | Used by | Contents |
|--------|---------|---------|
| `cargo-cache` | `contract-builder` | Cargo registry cache — speeds up rebuilds |
| `loki-data` | `loki` | Persistent log storage |
| `grafana-data` | `grafana` | Dashboard state and datasource config |

---

## Common Operations

```bash
# Start everything
docker compose up -d

# Watch logs for a specific service
docker compose logs -f backend

# Check health status
docker compose ps

# Restart only the backend
docker compose restart backend

# Tear down (keeps volumes)
docker compose down

# Tear down and delete all volumes (destructive)
docker compose down -v
```

---

## Related

- [Infrastructure overview](infrastructure.md)
- [Observability setup](observability.md)
- [Troubleshooting guide](troubleshooting.md)
- [Staging environment setup](../README.md#staging-environment)
