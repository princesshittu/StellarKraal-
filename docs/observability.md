# Observability Stack

StellarKraal uses a three-pillar observability stack: **Prometheus** for
metrics, **Loki + Promtail** for logs, and **Grafana** for dashboards and
alerting. This document covers architecture, configuration, every custom
metric, and how to extend the stack.

---

## Local Observability Stack Quick-Start

This section gives you a complete, step-by-step walkthrough for spinning up the
local observability stack, importing the pre-built dashboards, and writing your
first Loki log query. If you only want reference material, skip ahead to
[Architecture](#architecture).

### 1 — Prerequisites

- [Docker](https://docs.docker.com/get-docker/) **24+** and Docker Compose
  **v2** (included with Docker Desktop).
- The repository cloned and a valid `.env` file (copy `.env.example`).

Verify Docker is running:

```bash
docker info
```

### 2 — Start the full stack

Run the following from the repository root. The `--build` flag rebuilds the
backend/frontend images if you have local code changes:

```bash
docker compose up --build
```

On first run Docker pulls the Grafana, Loki, and Promtail images (~600 MB).
Subsequent starts are much faster.

Expected output once everything is healthy:

```
loki_1     | level=info ts=... msg="Loki started"
promtail_1 | level=info ts=... msg="Promtail started"
backend_1  | Server running on port 3001
grafana_1  | logger=http.server t=... msg="HTTP Server Listen" address=[::]:3000
```

> **Tip:** Run `docker compose up -d` to start in detached mode and keep your
> terminal free.

### 3 — Verify each service

| Service | URL | Expected response |
|---------|-----|-------------------|
| **Grafana** | http://localhost:3200 | Grafana login / home page |
| **Loki** | http://localhost:3100/ready | `ready` |
| **Backend API** | http://localhost:3001/api/v1/health | `{"status":"ok"}` |
| **Backend metrics** | http://localhost:3001/metrics | Prometheus text format |

> **Authentication:** The local Grafana instance is pre-configured with
> anonymous viewer access — you can browse dashboards without logging in.
> The default admin credentials are `admin` / `admin` (you will be prompted
> to change the password on first login).

### 4 — Access Grafana and open a dashboard

1. Open http://localhost:3200 in your browser.
2. Click the **Dashboards** icon (four squares) in the left sidebar.
3. You will see two pre-provisioned dashboards:

   | Dashboard | Description |
   |-----------|-------------|
   | **StellarKraal Backend** | HTTP request rate, error rate, latency percentiles, DB pool, RPC latency |
   | **StellarKraal Logs** | Live log streams from all containers |

4. Click **StellarKraal Logs** to open the log dashboard.

> **No data on metric panels?** Prometheus is not yet provisioned in
> `docker-compose.yml` (see [Known Gaps](#known-gaps)). Log panels work
> immediately without Prometheus.

### 5 — Import the loan dashboard JSON manually (optional)

The dashboards are auto-provisioned from `grafana/dashboards/` via the
mounted volume. If you have added a custom dashboard JSON file outside that
directory, you can import it manually:

1. In Grafana, click **Dashboards → Import**.
2. Click **Upload JSON file** and select your dashboard JSON.
3. Under **Options**, set the datasource to `Loki` (for log dashboards) or
   `Prometheus` (for metric dashboards).
4. Click **Import**.

To make the dashboard permanent (survive container restarts), save the JSON to
`grafana/dashboards/<name>.json` and restart Grafana:

```bash
docker compose restart grafana
```

Grafana reloads dashboard files from the mounted volume every 30 seconds, so
a restart is only needed if you add a new file.

### 6 — Write your first Loki log query

Loki queries use **LogQL** — a log query language similar to PromQL. Follow
these steps to explore logs in the Grafana Explore view:

1. Click the **Explore** icon (compass) in the left sidebar.
2. Make sure the datasource selector (top-left) shows **Loki**.
3. Enter a query in the query editor.

#### Basic queries

**All backend logs:**

```logql
{container="backend"}
```

**Only error-level lines:**

```logql
{container="backend"} | json | level="error"
```

**Lines containing a keyword** (loan liquidations):

```logql
{container="backend"} |= "liquidat"
```

**Structured field filter** (slow requests over 500 ms):

```logql
{service="backend"} | json | duration > 500
```

**Rate of errors per minute** (metric query):

```logql
sum(rate({container="backend"} | json | level="error" [1m]))
```

#### Filtering by time range

Use the time-range picker in the top-right corner of the Explore view. For
active development, **Last 15 minutes** or **Last 1 hour** works well. For
incident review, set an absolute range that covers the event window.

#### Useful label selectors

| Goal | LogQL |
|------|-------|
| All container logs | `{container=~"backend\|frontend"}` |
| Promtail errors | `{container="promtail"}` |
| Specific request ID | `{container="backend"} \|= "req-abc123"` |
| Auth failures | `{container="backend"} \|= "Unauthorized"` |
| RPC failures | `{service="backend"} \|= "rpc" \| level="error"` |
| Rate-limited requests | `{container="backend"} \|= "Too many requests"` |

> **Full LogQL reference:** https://grafana.com/docs/loki/latest/logql/

### 7 — Tear down

Stop all containers and remove the network:

```bash
docker compose down
```

To also delete the Grafana volume (resets all dashboard customisations):

```bash
docker compose down -v
```

---

## Architecture

```
backend ──┐
           ├─► Docker json-file logs ──► Promtail ──► Loki ──► Grafana
frontend ──┘

backend ──► prom-client registry ──► GET /metrics ──► Prometheus ──► Grafana
```

| Pillar | Tool | Purpose |
|--------|------|---------|
| Metrics | [Prometheus](https://prometheus.io/) | Scrapes numeric time-series from the backend `/metrics` endpoint |
| Logs | [Loki](https://grafana.com/oss/loki/) + [Promtail](https://grafana.com/docs/loki/latest/send-data/promtail/) | Aggregates structured logs from all Docker containers |
| Dashboards | [Grafana](https://grafana.com/oss/grafana/) | Visualises metrics and logs, fires alert notifications |

---

## Service URLs

### Local development

All services are defined in `docker-compose.yml`. Start the full stack:

```bash
docker compose up --build
```

| Service | URL | Credentials |
|---------|-----|-------------|
| Grafana | http://localhost:3200 | Anonymous viewer (no login) |
| Loki | http://localhost:3100 | — |
| Backend API | http://localhost:3001 | — |
| Prometheus | (not yet provisioned — see [Known Gaps](#known-gaps)) | — |

### Staging

Staging mirrors production. Observability services are deployed separately
(via Kubernetes Helm charts or equivalent). Access is restricted to VPN/SSO.

| Service | URL |
|---------|-----|
| Grafana | `https://grafana-staging.stellarkraal.example.com` |
| Prometheus | `https://prometheus-staging.stellarkraal.example.com` |
| Loki | `https://loki-staging.stellarkraal.example.com` |

Staging uses the same dashboard JSON files as local dev. Datasource URLs
point to the staging Loki/Prometheus endpoints rather than Docker service
names.

---

## Metrics (Prometheus)

### How it works

The backend uses [`prom-client`](https://github.com/siimon/prom-client) to
expose a Prometheus-compatible metrics registry. A middleware instruments
every HTTP request, and the connection pool reports DB metrics in real time.

The registry is exported at `GET /metrics` (exposed on port 3001 alongside
the API).

### Custom metrics

All custom metrics are defined in
[`backend/src/metrics.ts`](../backend/src/metrics.ts) and registered on a
dedicated `Registry` instance.

#### HTTP metrics

| Metric | Type | Labels | Buckets | Description |
|--------|------|--------|---------|-------------|
| `http_requests_total` | Counter | `method`, `route`, `status_code` | — | Total HTTP requests served since process start |
| `http_request_duration_seconds` | Histogram | `method`, `route`, `status_code` | 5ms, 10ms, 25ms, 50ms, 100ms, 250ms, 500ms, 1s, 2.5s, 5s | Request latency distribution |
| `http_active_connections` | Gauge | — | — | Number of concurrent connections right now |

**Instrumentation location:** inline middleware in
[`backend/src/index.ts`](../backend/src/index.ts) (lines ~211–223). Every
request increments `httpActiveConnections`, starts a duration timer, and
on `res.finish` records the count and latency with the route + status
labels.

#### RPC metrics

| Metric | Type | Labels | Buckets | Description |
|--------|------|--------|---------|-------------|
| `rpc_call_duration_seconds` | Histogram | `operation`, `status` | 50ms, 100ms, 250ms, 500ms, 1s, 2.5s, 5s, 10s | Soroban RPC call latency |

> **Note:** This metric is defined but not yet instrumented. See
> [Known Gaps](#known-gaps).

#### Database pool metrics

| Metric | Type | Labels | Buckets | Description |
|--------|------|--------|---------|-------------|
| `db_pool_acquired_total` | Counter | — | — | Total connections acquired from the pool since start |
| `db_pool_available` | Gauge | — | — | Current idle connections available in the pool |
| `db_pool_wait_ms` | Histogram | — | 0, 1, 5, 10, 25, 50, 100, 250, 500ms | Time waiting for a connection from the pool |

**Instrumentation location:** [`backend/src/utils/connectionPool.ts`](../backend/src/utils/connectionPool.ts). Metrics are updated on every `acquire()` and `release()` call.

#### Default Node.js metrics

`prom-client` also collects built-in Node.js metrics automatically:
`process_cpu_seconds_total`, `process_resident_memory_bytes`,
`nodejs_heap_size_total_bytes`, `nodejs_eventloop_lag_seconds`, etc. These
are included in every `/metrics` scrape.

### Prometheus alert rules

Alert rules are defined in
[`observability/prometheus-rules.yml`](../observability/prometheus-rules.yml)
and auto-generated from
[`backend/src/utils/alertRules.ts`](../backend/src/utils/alertRules.ts) via
`npm run generate:alert-rules`.

| Alert | Severity | Condition | For | Runbook |
|-------|----------|-----------|-----|---------|
| `HighP99Latency` | warning | p99 HTTP latency > 1s | 2 min | [Dashboard](#grafana-dashboards) |
| `HighErrorRate` | critical | 5xx rate > 1% of total | 1 min | [Dashboard](#grafana-dashboards) |
| `DbPoolExhaustion` | critical | `db_pool_available == 0` | 30s | [Dashboard](#grafana-dashboards) |
| `RpcFailure` | critical | `stellarkraal_alert_fired{rule="rpc-failure"}` | 5 min | [rpc-failure.md](runbooks/rpc-failure.md) |
| `RpcCircuitOpen` | critical | `stellarkraal_alert_fired{rule="rpc-circuit-open"}` | 10 min | [rpc-failure.md](runbooks/rpc-failure.md) |
| `DbError` | critical | `stellarkraal_alert_fired{rule="db-error"}` | 5 min | [db-error.md](runbooks/db-failure.md) |
| `LiquidationFailure` | critical | `stellarkraal_alert_fired{rule="liquidation-failure"}` | 2 min | [liquidation-failure.md](runbooks/liquidation-failure.md) |
| `5xxSpike` | critical | `stellarkraal_alert_fired{rule="5xx-spike"}` | 1 min | [5xx-spike.md](runbooks/high-error-rate.md) |
| `BackupFailure` | critical | `stellarkraal_alert_fired{rule="backup-failure"}` | 60 min | [restore-procedure.md](recovery/restore-procedure.md) |

### Alerting pipeline

Application-level alerts fire via
[`backend/src/utils/alerting.ts`](../backend/src/utils/alerting.ts):

1. The `fireAlert()` function checks a per-rule cooldown to prevent
   alert fatigue.
2. It sends to **Slack** (via `SLACK_WEBHOOK_URL` env var) and optionally
   **PagerDuty** (via `PAGERDUTY_ROUTING_KEY` for rules with
   `pagerduty: true`).
3. Each alert includes a link to the relevant runbook and the Grafana
   dashboard.

Environment variables for alerting are listed in
[`docs/guides/environment-variables.md`](guides/environment-variables.md).

---

## Logs (Loki + Promtail)

### How it works

Docker containers write logs to the `json-file` log driver. Promtail
discovers containers via the Docker socket, extracts labels
(`service`, `container`, `level`), and pushes log streams to Loki. Grafana
queries Loki via the LogQL language.

### Configuration files

| File | Purpose |
|------|---------|
| [`observability/promtail-config.yml`](../observability/promtail-config.yml) | Promtail scrape config — Docker socket discovery, relabeling, JSON pipeline |
| [`observability/grafana-datasources.yml`](../observability/grafana-datasources.yml) | Grafana datasource provisioning (Loki) |
| [`observability/grafana-dashboards.yml`](../observability/grafana-dashboards.yml) | Grafana dashboard provisioning — reads JSON from `/var/lib/grafana/dashboards` |

### Log labels

Promtail extracts these labels from container metadata:

| Label | Source | Example |
|-------|--------|---------|
| `service` | Docker container label `tag` | `backend`, `frontend` |
| `container` | Docker container name | `backend`, `frontend` |
| `stream` | Docker log stream | `stdout`, `stderr` |
| `level` | Parsed from JSON log line | `info`, `error`, `warn` |

### Useful LogQL queries

| Purpose | LogQL |
|---------|-------|
| All backend logs | `{container="backend"}` |
| All errors | `{container=~"backend\|frontend"} \| level="error"` |
| Slow requests (>1s) | `{service="backend"} \| json \| duration > 1000` |
| RPC failures | `{service="backend"} \|~ "rpc" \| level="error"` |
| Auth failures | `{container="backend"} \|= "Unauthorized"` |
| Loan liquidations | `{container="backend"} \|= "liquidat"` |
| Rate-limited requests | `{container="backend"} \|= "Too many requests"` |

---

## Grafana Dashboards

> **Screenshots:** The annotated screenshots below show the expected appearance of each dashboard when the full stack is running with live data. They were generated from a populated local dev environment (`docker compose up --build`).
>
> **Updating screenshots:** When the dashboard layout changes significantly (panels added, removed, or re-arranged), retake the screenshots and replace the files in `docs/images/dashboards/`. Follow the [screenshot update guide](#screenshot-update-guide) at the end of this section.

### Dashboard files

| Dashboard | File | UID | Panels |
|-----------|------|-----|--------|
| StellarKraal Backend | [`grafana/dashboards/backend.json`](../grafana/dashboards/backend.json) | `stellarkraal-backend` | 9 panels (metrics) |
| StellarKraal Logs | [`grafana/dashboards/logs.json`](../grafana/dashboards/logs.json) | `stellarkraal-logs` | 4 panels (log streams) |

### Backend dashboard — overview

![StellarKraal Backend Grafana dashboard showing nine metric panels arranged in a three-row grid. Top row: Request Rate (req/s) timeseries by route, Error Rate (5xx/s) timeseries, and Latency Percentiles (p50/p95/p99) timeseries. Middle row: Active Connections stat panel (large green number), RPC Call Latency p95 timeseries, and DB Pool — Available Connections stat panel. Bottom row: DB Pool — Acquired Total stat panel, DB Pool — Acquire Wait Latency (p95) timeseries, and an Alert Rules markdown table listing all Prometheus rules with their severity and status.](images/dashboards/backend-overview.png)

**Callout annotations:**

| Panel | What to check |
|-------|--------------|
| **Request Rate (req/s)** — top-left timeseries | Baseline throughput per route. A sudden drop indicates a frontend/load balancer issue; a sudden spike may precede resource exhaustion. |
| **Error Rate (5xx/s)** — top-centre timeseries | Should be at or near zero in a healthy environment. Any sustained value above the `HighErrorRate` threshold (1% of total) will fire an alert. |
| **Latency Percentiles (p50/p95/p99)** — top-right timeseries | p99 > 1 s fires the `HighP99Latency` warning alert. Compare p50 vs p99 spread to identify tail latency issues. |
| **Active Connections** — middle-left stat | Instantaneous concurrent HTTP connections. Correlate with error rate spikes to identify overload. |
| **RPC Call Latency (p95)** — middle-centre timeseries | Soroban RPC round-trip time. Latency > 2 s or a flat/silent graph (no data) indicates RPC degradation. See [RPC outage runbook](runbooks/on-call.md#1-rpc-outage). |
| **DB Pool — Available Connections** — middle-right stat | Zero means the pool is exhausted and new requests will queue or fail. See [DB exhaustion runbook](runbooks/on-call.md#3-db-connection-exhaustion). |
| **DB Pool — Acquire Wait Latency (p95)** — bottom-centre timeseries | Rising wait time is the early warning signal before pool exhaustion. Investigate if p95 exceeds 50 ms. |
| **Alert Rules** — bottom-right text panel | Live Markdown table of all Prometheus alert rules. Red rows indicate currently firing alerts. |

> **Note on empty panels:** The *Request Rate*, *Error Rate*, *Latency*, and *RPC* panels require a running Prometheus instance. See [Known Gaps](#known-gaps) if these panels show "No data".

---

### Backend dashboard — DB pool detail

![Zoomed-in view of the three DB pool panels in the StellarKraal Backend dashboard. DB Pool — Available Connections shows a stat of 4 (green, healthy). DB Pool — Acquired Total shows a counter of 128 (blue). DB Pool — Acquire Wait Latency (p95) shows a flat timeseries at approximately 1 ms, indicating no pool pressure.](images/dashboards/backend-db-pool.png)

**Callout annotations:**

- **Available = 0 (red):** All connections are in use. New `acquire()` calls will block until a connection is released or the pool timeout is exceeded. Restart the backend to drain hung connections.
- **Acquire Wait p95 rising:** If wait time climbs above 25–50 ms, a connection leak or query bottleneck is forming. Check for long-running queries in the logs before the pool hits zero.
- **Acquired Total:** A monotonically increasing counter. Use the rate (`rate(db_pool_acquired_total[1m])`) in the Explore view to see connections-per-second.

---

### Logs dashboard — overview

![StellarKraal Logs Grafana dashboard showing four log panels stacked vertically. From top to bottom: All Logs panel showing mixed info/warn/error lines from backend and frontend containers; Errors panel showing only error-level lines highlighted in red; Slow Requests panel showing log lines for requests exceeding 1000 ms with duration values visible in the structured fields; RPC Failures panel showing log lines matching rpc and error keywords with JSON fields expanded.](images/dashboards/logs-overview.png)

**Callout annotations:**

| Panel | What to check |
|-------|--------------|
| **All Logs** — top | Full log stream from `backend` and `frontend` containers. Use the search bar to filter by `requestId` (matches `X-Request-ID` response header) when tracing a specific request. |
| **Errors** — second | Filtered to `level="error"`. Use this as the first stop during an incident — scan for repeating error messages and correlate their timestamps with the metric panels in the backend dashboard. |
| **Slow Requests (>1 s)** — third | Log lines where `duration > 1000` ms. Persistent entries here indicate a route that is consistently slow — cross-reference with the *Latency Percentiles* panel in the backend dashboard. |
| **RPC Failures** — bottom | Log lines containing both `rpc` and `error` keywords. Non-zero entries here trigger the `rpc-failure` alert. See [RPC outage runbook](runbooks/on-call.md#1-rpc-outage). |

---

### Screenshot update guide

When the dashboard layout changes significantly, update the screenshots using the following steps:

1. Start the full stack: `docker compose up --build`
2. Seed the environment with test data (run load tests or simulate traffic) so panels show real data.
3. Open Grafana at `http://localhost:3200` and navigate to the target dashboard.
4. Set the time range to the last 15 minutes.
5. Take a full-page screenshot at **1920 × 1080** resolution:
   - On Linux: use `gnome-screenshot`, `scrot`, or the Grafana built-in **Share → PNG** export.
   - On macOS: use `Command + Shift + 4` then crop to the dashboard area.
6. Save the file to `docs/images/dashboards/` using the filename from the table below.
7. For zoomed-in panel screenshots, crop to the relevant panel area.
8. Update the `alt` text in `docs/observability.md` to reflect any panel changes.
9. Commit the updated image and documentation changes together.

| Screenshot | Filename | Description |
|-----------|---------|-------------|
| Backend dashboard — full view | `backend-overview.png` | All 9 panels at 1920×1080 |
| Backend dashboard — DB pool panels | `backend-db-pool.png` | Three DB pool panels zoomed in |
| Logs dashboard — full view | `logs-overview.png` | All 4 log panels at 1920×1080 |

### Backend dashboard panels

The backend dashboard (`grafana/dashboards/backend.json`) contains the following panels. See the [annotated screenshot above](#backend-dashboard--overview) for their visual layout and what to look for during an incident.

| Panel | Type | PromQL / Description |
|-------|------|----------------------|
| Request Rate (req/s) | timeseries | `sum(rate(http_requests_total[1m])) by (route)` |
| Error Rate (5xx/s) | timeseries | `sum(rate(http_requests_total{status_code=~"5.."}[1m]))` |
| Latency Percentiles (p50/p95/p99) | timeseries | `histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))` |
| Active Connections | stat | `http_active_connections` |
| RPC Call Latency (p95) | timeseries | `histogram_quantile(0.95, sum(rate(rpc_call_duration_seconds_bucket[5m])) by (le, operation))` |
| DB Pool — Available Connections | stat | `db_pool_available` |
| DB Pool — Acquired Total | stat | `db_pool_acquired_total` |
| DB Pool — Acquire Wait Latency (p95) | timeseries | `histogram_quantile(0.95, sum(rate(db_pool_wait_ms_bucket[5m])) by (le))` |
| Alert Rules | text | Markdown table of all Prometheus alert rules |

### Logs dashboard panels

The logs dashboard (`grafana/dashboards/logs.json`) contains the following panels. See the [annotated screenshot above](#logs-dashboard--overview) for their visual layout and what to look for during an incident.

| Panel | Type | LogQL |
|-------|------|-------|
| All Logs | logs | `{container=~"backend\|frontend"}` |
| Errors | logs | `{container=~"backend\|frontend"} \|= "error" \| level="error"` |
| Slow Requests (>1s) | logs | `{service="backend"} \| json \| duration > 1000` |
| RPC Failures | logs | `{service="backend"} \|= "rpc" \|= "error"` |

### Accessing dashboards

1. Start the stack: `docker compose up --build`
2. Open Grafana: http://localhost:3200
3. Navigate to **Dashboards** in the sidebar:
   - **StellarKraal Backend** — real-time metrics (requires Prometheus; see Known Gaps)
   - **StellarKraal Logs** — live log streaming from Loki

---

## How to Add a New Metric

### 1. Define the metric

Add a new metric in [`backend/src/metrics.ts`](../backend/src/metrics.ts):

```typescript
export const myNewCounter = new Counter({
  name: "my_new_counter_total",
  help: "Description of what this counter tracks",
  labelNames: ["label1", "label2"] as const,
  registers: [registry],
});
```

Supported types:
- **Counter** — monotonically increasing value (e.g. request count)
- **Gauge** — value that can go up and down (e.g. pool size)
- **Histogram** — value distribution with configurable buckets (e.g. latency)

### 2. Instrument the code

Import and use the metric where the event occurs:

```typescript
import { myNewCounter } from "./metrics";

// Increment
myNewCounter.inc();
myNewCounter.inc({ label1: "value1", label2: "value2" });

// For histograms
import { myNewHistogram } from "./metrics";
myNewHistogram.observe(durationInSeconds);
```

### 3. Add a test

Add a test in [`backend/src/metrics.test.ts`](../backend/src/metrics.test.ts)
following the existing pattern:

```typescript
it("my_new_counter increments", async () => {
  const before = await myNewCounter.get();
  myNewCounter.inc();
  const after = await myNewCounter.get();
  expect(after.values[0].value).toBe(before.values[0].value + 1);
});
```

### 4. Add a dashboard panel

Edit the relevant dashboard JSON in `grafana/dashboards/`. Add a new panel
object to the `panels` array:

```json
{
  "id": 10,
  "title": "My New Metric",
  "type": "timeseries",
  "gridPos": { "x": 0, "y": 28, "w": 12, "h": 8 },
  "targets": [
    {
      "expr": "rate(my_new_counter_total[1m])",
      "legendFormat": "{{label1}}"
    }
  ]
}
```

Grid positions use a 24-column layout. See the [Grafana panel JSON
docs](https://grafana.com/docs/grafana/latest/dashboards/build-dashboards/add-panels/)
for reference.

### 5. Add an alert rule (optional)

Add the rule to [`backend/src/utils/alertRules.ts`](../backend/src/utils/alertRules.ts):

```typescript
myNewAlert: {
  id: "my-new-alert",
  name: "My New Alert",
  severity: "warning",
  cooldownMs: 5 * 60 * 1000,
  runbook: "my-new-alert.md",
  pagerduty: false,
},
```

Then regenerate the Prometheus rules file:

```bash
cd backend && npm run generate:alert-rules
```

This updates `observability/prometheus-rules.yml` with the new rule. The CI
pipeline validates the file with `promtool check rules`.

---

## How to Add a Dashboard Panel

1. Open Grafana at http://localhost:3200
2. Navigate to the target dashboard (e.g. **StellarKraal Backend**)
3. Click **Add panel** → choose visualization type
4. Enter the PromQL or LogQL query
5. Adjust panel title, legend, thresholds as needed
6. Click **Apply** → **Save dashboard**

To export the updated dashboard JSON back to the repo:

1. Click the **Share** icon → **Export**
2. Toggle **Export for sharing externally**
3. Save the JSON to `grafana/dashboards/<name>.json`
4. Commit the file — Grafana auto-reloads from the mounted volume every 30s

---

## Configuration Reference

### Docker Compose services

| Service | Image | Port | Config |
|---------|-------|------|--------|
| `loki` | `grafana/loki:2.9.4` | 3100 | Built-in local config |
| `promtail` | `grafana/promtail:2.9.4` | 9080 (internal) | `observability/promtail-config.yml` |
| `grafana` | `grafana/grafana:10.4.2` | 3200 → 3000 | Datasource + dashboard provisioning |

### Grafana provisioning

| File | Mounted at | Purpose |
|------|------------|---------|
| `observability/grafana-datasources.yml` | `/etc/grafana/provisioning/datasources/datasources.yml` | Loki datasource |
| `observability/grafana-dashboards.yml` | `/etc/grafana/provisioning/dashboards/dashboards.yml` | Dashboard file provider |
| `grafana/dashboards/*.json` | `/var/lib/grafana/dashboards/` | Dashboard definitions |

### Prometheus scrape configuration

The `/metrics` endpoint is protected by an optional bearer token. Set
`METRICS_TOKEN` in the backend environment to enable authentication:

```bash
METRICS_TOKEN=$(openssl rand -hex 32)
```

In `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'stellarkraal-backend'
    static_configs:
      - targets: ['backend:3001']
    authorization:
      type: Bearer
      credentials: ${METRICS_TOKEN}
```

When `METRICS_TOKEN` is unset, `/metrics` remains unauthenticated. This is
intended for local development only; always set the token in staging and
production.

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SLACK_WEBHOOK_URL` | — | Slack incoming webhook URL for alert notifications |
| `PAGERDUTY_ROUTING_KEY` | — | PagerDuty integration key for critical alerts |
| `RUNBOOK_BASE_URL` | `https://github.com/teslims2/StellarKraal-/blob/main/docs/runbooks` | Base URL for runbook links in alerts |
| `METRICS_TOKEN` | — | Optional bearer token to protect `GET /metrics` |

---

## Production Deployment

Replace the Docker socket-based Promtail setup with infrastructure-native
log shipping:

| Infrastructure | Recommended approach |
|----------------|---------------------|
| Kubernetes | Promtail DaemonSet or Grafana Alloy agent |
| VMs (AWS/GCP) | Promtail installed via systemd, or CloudWatch → Loki |
| Docker Swarm | Promtail service with `/var/run/docker.sock` mount |

Key production changes:

1. **Grafana auth** — set `GF_AUTH_ANONYMOUS_ENABLED=false` and configure
   SSO or local users.
2. **Loki storage** — use S3/GCS object storage for production-grade log
   retention (the default filesystem backend is fine for dev only).
3. **Prometheus** — deploy a Prometheus server that scrapes
   `http://backend:3001/metrics` at 15s intervals.
4. **Network** — restrict Loki (3100) and Prometheus (9090) to internal
   network only.
5. **Alert routing** — configure `SLACK_WEBHOOK_URL` and
   `PAGERDUTY_ROUTING_KEY` as secrets in your deployment platform.

---

## Known Gaps

The following items are identified gaps in the current observability setup:

| Gap | Impact | Workaround |
|-----|--------|------------|
| **No Prometheus service** in `docker-compose.yml` | Backend dashboard panels are empty in local dev | Deploy Prometheus locally or use Grafana Cloud |
| **No Prometheus datasource** in `grafana-dashboards.yml` | Grafana cannot query Prometheus metrics | Add a Prometheus datasource pointing to your Prometheus instance |
| **`rpc_call_duration_seconds`** is defined but not instrumented | RPC latency panels are empty | Instrument the RPC client wrapper in `utils/rpcClient.ts` |
| **`stellarkraal_alert_fired`** metric referenced in alert rules is not emitted | 6 of 9 alerts will never fire | Emit the metric from `fireAlert()` in `utils/alerting.ts` |

These gaps are tracked as GitHub issues and are outside the scope of this
documentation update.

---

## File Map

| File | Purpose |
|------|---------|
| `backend/src/metrics.ts` | Metric definitions (prom-client registry) |
| `backend/src/metrics.test.ts` | Unit tests for metric registration and recording |
| `backend/src/index.ts` | HTTP instrumentation middleware (~lines 211–223) |
| `backend/src/utils/connectionPool.ts` | DB pool metric instrumentation |
| `backend/src/utils/alerting.ts` | Alert dispatch (Slack + PagerDuty) |
| `backend/src/utils/alertRules.ts` | Alert rule definitions (source of truth) |
| `observability/promtail-config.yml` | Promtail scrape + pipeline config |
| `observability/grafana-datasources.yml` | Grafana datasource provisioning |
| `observability/grafana-dashboards.yml` | Grafana dashboard provisioning |
| `observability/prometheus-rules.yml` | Prometheus alert rules (auto-generated) |
| `grafana/dashboards/backend.json` | Backend metrics dashboard |
| `grafana/dashboards/logs.json` | Log streaming dashboard |

---

## Related

- Prometheus metrics: [`docs/protocol/liquidation.md`](protocol/liquidation.md) *(see also `GET /metrics` endpoint)*
- Backend logger: [`backend/src/utils/logger.ts`](../backend/src/utils/logger.ts)
- Alerting configuration: [`docs/guides/alerting.md`](guides/alerting.md) — how alert rules are structured and how to add new ones
- On-call runbook: [`docs/runbooks/on-call.md`](runbooks/on-call.md) — incident response for RPC outages, contract errors, DB exhaustion, and high liquidation rate
