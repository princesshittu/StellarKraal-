# Performance Tuning Guide

This guide covers the knobs available to improve API throughput and latency beyond what the defaults provide. Read [performance/README.md](../backend/performance/README.md) first to understand how baselines and benchmarks work.

---

## Current Baselines (p99)

| Endpoint | Baseline | Regression threshold (+20%) |
|----------|----------|-----------------------------|
| `GET /api/v1/loans` | 50 ms | 60 ms |
| `GET /api/v1/collateral` | 50 ms | 60 ms |
| `POST /api/v1/loans` | 100 ms | 120 ms |

Benchmarks run 50 concurrent connections for 30 seconds. CI fails if p99 exceeds the threshold.

---

## Environment Variables

All performance-related env vars have sensible defaults. Override them in `.env` or your deployment config.

### Connection Pool

| Variable | Default | Description |
|----------|---------|-------------|
| `POOL_MIN` | `2` | Minimum number of kept-alive SQLite connections |
| `POOL_MAX` | `10` | Maximum concurrent connections before callers queue |

Increase `POOL_MAX` if you see connection wait times under sustained load. Keep it proportional to the CPU count of the host — SQLite is not parallel-safe for writes, so very large pools don't help for write-heavy workloads.

### Request Timeouts

| Variable | Default | Applies to |
|----------|---------|-----------|
| `TIMEOUT_GLOBAL_MS` | `10000` | All routes (global middleware) |
| `TIMEOUT_WRITE_MS` | `15000` | Write/mutation routes |
| `TIMEOUT_CONTRACT_MS` | `30000` | Soroban contract submission routes |

Lowering `TIMEOUT_GLOBAL_MS` improves tail-latency under overload by shedding slow requests early, but may cause false timeouts when the DB or RPC is under brief load spikes. Don't go below 2000 ms.

The contract timeout is deliberately long because transaction preparation and Soroban simulation can be slow (network round-trips, XDR serialisation). Reduce it only if your RPC endpoint is co-located.

### Rate Limits

| Variable | Default | Applies to |
|----------|---------|-----------|
| `RATE_LIMIT_GLOBAL` | `60` | All routes (requests/min/IP) |
| `RATE_LIMIT_AUTH` | `10` | Auth routes |
| `RATE_LIMIT_READ` | `100` | Read (GET) routes |
| `RATE_LIMIT_WRITE` | `10` | Write (POST/PUT/DELETE) routes |

Rate limits protect the API from individual abusive clients. They are not a substitute for capacity planning — if legitimate traffic consistently hits these limits, scale the service instead of raising the limits.

### Appraisal Cache

| Variable | Default | Description |
|----------|---------|-------------|
| `APPRAISAL_CACHE_TTL_MS` | `300000` | Time-to-live for cached collateral appraisal values (5 min) |

Appraisals are cached in-process to avoid redundant DB reads on every loan request. Increase the TTL if appraisal values change infrequently and reads are a bottleneck. Decrease it (or invalidate explicitly via `invalidateAll()`) when fresh values are required.

---

## SQLite-Specific Optimisations

StellarKraal uses SQLite as its default off-chain database ([ADR-003](adr/ADR-003-sqlite.md)).
While SQLite is well-suited for single-node workloads, its defaults are conservative. The
settings below materially improve throughput under the read-heavy, occasionally-write workload
typical of StellarKraal's API.

All PRAGMA settings documented here are applied automatically by the migration runner at
startup (`backend/src/db/database.ts`). This section explains what each setting does and what
to change if you need to tune further.

---

### WAL mode

SQLite's default journal mode (`DELETE`) takes an exclusive lock on writes, blocking all
concurrent readers. WAL (Write-Ahead Logging) mode allows one writer and multiple readers to
proceed simultaneously, which significantly improves read throughput under load.

```sql
PRAGMA journal_mode = WAL;
```

Verify the current mode:

```bash
sqlite3 backend/dev.sqlite3 "PRAGMA journal_mode;"
# expected output: wal
```

WAL mode is persistent — it survives process restarts. You only need to set it once.

**When to revert:** WAL mode uses a separate `-wal` and `-shm` file alongside the main
database file. If your deployment platform does not support multiple files per database (e.g.,
some serverless environments), keep the default `DELETE` mode and accept the write-lock
contention.

---

### Recommended PRAGMA settings

Apply the following PRAGMAs immediately after opening each connection. They are transient
(reset on every connection), so they must be applied per-connection in the pool setup:

```sql
-- Disable full fsync after each write; rely on WAL checkpointing instead.
-- Values: 0 (OFF), 1 (NORMAL), 2 (FULL — default)
PRAGMA synchronous = NORMAL;

-- In-memory page cache size. Negative value = kibibytes; positive = pages.
-- -64000 = 64 MB. Default is -2000 (2 MB).
PRAGMA cache_size = -64000;

-- Increase temp store to RAM to avoid spilling sorts/joins to disk.
-- 0 = default (file), 1 = file, 2 = memory
PRAGMA temp_store = MEMORY;

-- Enable memory-mapped I/O for the database file (in bytes).
-- 256 MB is suitable for databases up to ~1 GB.
PRAGMA mmap_size = 268435456;

-- Busy timeout in milliseconds. Causes writers to retry instead of
-- immediately returning SQLITE_BUSY when the WAL is locked.
PRAGMA busy_timeout = 5000;
```

| PRAGMA | Default | Recommended | Effect |
|--------|---------|-------------|--------|
| `journal_mode` | `DELETE` | `WAL` | Concurrent readers during writes |
| `synchronous` | `FULL` | `NORMAL` | ~2× write throughput; safe with WAL |
| `cache_size` | `−2000` (2 MB) | `−64000` (64 MB) | Fewer disk reads for hot pages |
| `temp_store` | `0` (file) | `2` (memory) | Faster sorts/joins |
| `mmap_size` | `0` | `268435456` | Memory-mapped reads bypass syscalls |
| `busy_timeout` | `0` | `5000` | Retry on write contention instead of failing |

---

### Connection pool sizing guidelines

The connection pool is configured via `POOL_MIN` and `POOL_MAX` environment variables
(`backend/src/utils/connectionPool.ts`).

```
POOL_MIN=2
POOL_MAX=10
```

Guidelines:

- **SQLite is single-writer.** Increasing `POOL_MAX` beyond the number of concurrent
  read-only request handlers does not improve write throughput — only one write transaction
  can proceed at a time regardless of pool size.
- **For read-heavy workloads** (typical for StellarKraal): set `POOL_MAX` to `2×CPU_count`.
  On a 2-core host, `POOL_MAX=4` is a good starting point.
- **For write-heavy workloads**: keep `POOL_MAX` low (4–6). Large pools cause connection
  wait times to spike while the single write lock is held.
- **Monitor pool utilisation** in Grafana (`backend` dashboard → "DB pool utilisation"). If
  utilisation is consistently above 80%, increase `POOL_MAX` or profile write bottlenecks.
- **Do not set `POOL_MAX` above 20** with SQLite. Above that threshold, write contention
  dominates and you should consider migrating to PostgreSQL (see below).

---

### Benchmark results

The following figures were recorded on a 2-core / 4 GB RAM host running the full benchmark
suite (`npm run perf:test`, 50 concurrent connections, 30 s).

| Configuration | `GET /api/v1/loans` p99 | `POST /api/v1/loans` p99 |
|---------------|------------------------|--------------------------|
| Defaults (no PRAGMA tuning) | ~120 ms | ~210 ms |
| WAL + `synchronous=NORMAL` only | ~75 ms | ~140 ms |
| WAL + all PRAGMAs above | ~48 ms | ~98 ms |

These numbers match the [current CI baselines](#current-baselines-p99) used as regression
thresholds.

> Results will vary by hardware and database size. Run `npm run perf:test` in your own
> environment before and after tuning to validate the impact.

---

### When to migrate from SQLite to PostgreSQL

SQLite is excellent for single-node, low-to-medium traffic deployments. Consider migrating to
PostgreSQL when any of the following apply:

| Signal | Threshold | Action |
|--------|-----------|--------|
| Write throughput | Sustained >100 writes/sec | Migrate to PostgreSQL |
| Database file size | >5 GB | Migrate (SQLite has no partitioning or table spaces) |
| Concurrent writers | >1 process writing simultaneously | Migrate (SQLite WAL still serialises writes) |
| Replication required | — | Migrate (SQLite has no built-in replication) |
| Horizontal scaling | >1 backend instance | Migrate (each instance has its own SQLite file; they cannot share state) |

To switch, set `DATABASE_URL` to a `postgres://` connection string. The application detects the
`postgres://` prefix at startup and uses the PostgreSQL driver instead of SQLite
(`backend/src/db/database.ts`). Run migrations after switching: `npm run migrate:dev`.

See [ADR-003](adr/ADR-003-sqlite.md) for the full rationale behind choosing SQLite for the
initial deployment.

---

### WAL Mode

Ensure the database file is in WAL (Write-Ahead Logging) mode for better read/write concurrency:

```sql
PRAGMA journal_mode=WAL;
```

This is applied automatically by the migration runner in development. Verify it in production with:

```bash
sqlite3 backend/dev.sqlite3 "PRAGMA journal_mode;"
# expected: wal
```

### Indexes

The migration `002_add_query_indexes.sql` adds indexes on the most common filter columns. If you add new filterable columns, add a corresponding index rather than relying on full-table scans.

### PostgreSQL (Production)

Set `DATABASE_URL` to a `postgres://` or `postgresql://` connection string to switch from SQLite to PostgreSQL. PostgreSQL handles concurrent writes better and is recommended for production.

With PostgreSQL, tune the connection pool (`POOL_MIN`/`POOL_MAX`) to stay within your database's `max_connections` limit. A pool of 10–20 is typical for a single-node backend.

---

## Response Caching

GET routes for `/api/loans` and `/api/collateral` use an in-process response cache (`backend/src/utils/responseCache.ts`). Cached responses bypass DB reads entirely.

The cache is invalidated automatically on write operations. If you have multiple backend instances behind a load balancer, each instance has its own cache — consider a shared cache (Redis) if stale reads across instances are a concern.

---

## Compression

The `compressionMiddleware` (`backend/src/middleware/compression.ts`) gzip-compresses responses above a threshold. It is applied globally. Ensure your reverse proxy or CDN does not decompress and re-compress responses, which would waste CPU.

---

## Graceful Shutdown

`SHUTDOWN_TIMEOUT_MS` (default 10 000 ms) controls how long the server waits for in-flight requests to finish before forcing exit. Under high concurrency, increase this to avoid cutting off slow contract submissions mid-flight.

---

## Identifying Bottlenecks

### 1. Run the benchmark suite

```bash
cd backend
npm run perf:test
```

Results land in `benchmark-results.json`. Compare p99 against baselines.

### 2. Check the Grafana dashboards

Grafana runs at `http://localhost:3200`. The backend dashboard shows:

- Request rate and error rate per route
- p50 / p95 / p99 latency histograms
- Active connections
- DB pool utilisation

### 3. Query Loki for slow requests

```
{job="backend"} | json | duration > 500
```

### 4. Profile the Node.js process

```bash
# Attach the built-in profiler
node --prof dist/index.js

# Convert the isolate log to readable output
node --prof-process isolate-*.log > profile.txt
```

Look for hot functions in the flamegraph. Common culprits: XDR serialisation, synchronous DB reads, and JSON stringify on large payloads.

---

## Benchmarking Guide

This section explains how to run load tests, interpret the results, profile the Node.js
process with flame graphs, and fix the most common backend bottlenecks.

### Prerequisites

Install [autocannon](https://github.com/mcollina/autocannon) globally (or use `npx`):

```bash
npm install -g autocannon
# or use npx autocannon without installing
```

Ensure the backend is running and reachable before starting any test:

```bash
cd backend && npm run build && npm start
# Backend listens on http://localhost:3001 by default
```

---

### Running Load Tests with autocannon

#### Basic read-path test

```bash
autocannon \
  --connections 50 \
  --duration 30 \
  --method GET \
  http://localhost:3001/api/v1/loans
```

| Flag | Meaning |
|------|---------|
| `--connections 50` | 50 concurrent HTTP/1.1 connections held open (pipelining disabled) |
| `--duration 30` | Run for 30 seconds |
| `--method GET` | HTTP verb |

#### Authenticated endpoints

Most write routes require a valid JWT. Pass it via a header:

```bash
autocannon \
  --connections 10 \
  --duration 30 \
  --method GET \
  --header "Authorization: Bearer <YOUR_JWT>" \
  http://localhost:3001/api/v1/collateral
```

#### Write-path test (POST)

Use `--body` and `--content-type` to send a JSON payload:

```bash
autocannon \
  --connections 5 \
  --duration 30 \
  --method POST \
  --header "Authorization: Bearer <YOUR_JWT>" \
  --header "Content-Type: application/json" \
  --body '{"collateralId":"<id>","amount":500}' \
  http://localhost:3001/api/v1/loans
```

> Keep `--connections` low (≤ 10) for write paths. High concurrency on write routes mutates
> database and on-chain state, which can leave test data behind. Run write-path tests against
> staging only, never production.

#### Full benchmark suite

The project's built-in benchmark runner exercises all endpoints and records structured results:

```bash
cd backend
npm run perf:test
# Results written to backend/benchmark-results.json
```

---

### Latency Targets (p50 / p95 / p99)

The following targets apply to the staging environment under a 50-connection, 30-second load test.
CI fails when p99 exceeds the regression threshold (baseline + 20 %).

| Endpoint | p50 target | p95 target | p99 target | p99 regression threshold |
|----------|-----------|-----------|-----------|--------------------------|
| `GET /api/v1/loans` | ≤ 20 ms | ≤ 40 ms | ≤ 50 ms | 60 ms |
| `GET /api/v1/collateral` | ≤ 20 ms | ≤ 40 ms | ≤ 50 ms | 60 ms |
| `POST /api/v1/loans` | ≤ 50 ms | ≤ 80 ms | ≤ 100 ms | 120 ms |
| `POST /api/v1/collateral` | ≤ 50 ms | ≤ 80 ms | ≤ 100 ms | 120 ms |
| `GET /api/v1/health` | ≤ 5 ms | ≤ 10 ms | ≤ 15 ms | 20 ms |

**Reading the autocannon output**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             Latency (ms)                                    │
├───────────┬───────────┬───────────┬───────────┬──────────┬──────────────────┤
│  2.5%     │  50%      │  97.5%    │  99%      │  Avg     │  Max             │
│  4        │  11       │  38       │  48       │  13.1    │  212             │
└───────────┴───────────┴───────────┴───────────┴──────────┴──────────────────┘
```

- **50%** — median latency. Most requests finish in this time.
- **97.5%** — close to p99. The difference between 97.5% and 99% reveals outlier behaviour.
- **99%** — the value compared against the regression threshold.
- **Max** — the single slowest request. A very high max (e.g., 10× p99) often signals a
  connection pool wait or a GC pause rather than a code-level regression.

---

### Profiling with `--inspect` and Flame Graphs

Profiling lets you pinpoint which functions consume the most CPU, so you can direct
optimisation effort precisely.

#### Step 1 — Start the server with the CPU profiler

```bash
cd backend
node --prof dist/index.js
```

Node.js writes a V8 isolate log file (`isolate-0x…-v8.log`) to the current directory.

#### Step 2 — Generate load while profiling

Run an autocannon test while the server is under the profiler. This ensures the profile
captures real request-handling code rather than idle behaviour:

```bash
autocannon --connections 50 --duration 30 http://localhost:3001/api/v1/loans
```

Stop the server with `Ctrl+C` after the load test completes. Node.js flushes the log on exit.

#### Step 3 — Convert the log to human-readable output

```bash
node --prof-process isolate-0x*.log > profile.txt
```

Open `profile.txt` and look for the **"Bottom up (heavy) profile"** section. The top entries
are the functions where the process spends the most time.

#### Step 4 — Generate a flame graph (optional but recommended)

[0x](https://github.com/davidmarkclements/0x) generates an interactive SVG flame graph in one step:

```bash
# Install 0x
npm install -g 0x

# Profile and generate flame graph automatically
0x dist/index.js &
SERVER_PID=$!
autocannon --connections 50 --duration 30 http://localhost:3001/api/v1/loans
kill $SERVER_PID
# 0x writes a .html flame graph to a timestamped directory
```

Open the generated `.html` file in a browser. Wide bars near the top of the stack indicate hot paths. Look for:

- `JSON.stringify` / `JSON.parse` — large serialisation
- `Database#prepare` / `Statement#run` — synchronous DB calls outside the pool
- `SorobanClient` / XDR functions — contract simulation overhead
- Long GC frames (`v8::internal::Heap`) — memory pressure, increase `--max-old-space-size`

#### Step 5 — Profile using the Chrome DevTools inspector

For a graphical UI without installing extra tools:

```bash
node --inspect dist/index.js
```

Open Chrome and navigate to `chrome://inspect`. Click **"Open dedicated DevTools for Node"**.
Under the **Profiler** tab, click **Start**, run your load test, then click **Stop**. The
DevTools flame chart is interactive — hover over any frame to see the function name,
file, and self-time.

---

### Common Bottlenecks and Fixes

#### N+1 Query Problem

**Symptom**: p99 increases linearly as the number of rows grows. In the flame graph you see many short `Statement#get` frames, each for a single row.

**Cause**: The code fetches a list of IDs, then issues one `SELECT` per ID inside a loop instead of a single bulk query.

**Example (bad)**:
```typescript
// Fetches each collateral record individually — N+1 queries
const loans = await listLoans();
for (const loan of loans) {
  loan.collateral = await getCollateral(loan.collateralId); // one query per loan
}
```

**Fix**: Use a single `WHERE id IN (...)` query or a JOIN:
```typescript
const loans = await listLoans();
const ids = loans.map(l => l.collateralId);
const collaterals = await getCollateralByIds(ids); // one query for all
const byId = Object.fromEntries(collaterals.map(c => [c.id, c]));
for (const loan of loans) {
  loan.collateral = byId[loan.collateralId];
}
```

Alternatively, add the collateral join directly to `listLoans` using a SQL `LEFT JOIN`.

---

#### Large JSON Serialisation

**Symptom**: `JSON.stringify` appears near the top of the flame graph. Response sizes exceed 100 KB for list endpoints.

**Cause**: List endpoints return full objects when the client only needs a subset of fields.

**Fix 1 — Projection**: Return only the fields the client needs:
```typescript
// Before: serialise everything
res.json(loans);

// After: project to a smaller shape
res.json(loans.map(({ id, status, amount, createdAt }) => ({ id, status, amount, createdAt })));
```

**Fix 2 — Pagination**: Cap the maximum number of records returned per request. See [PAGINATION.md](PAGINATION.md) for the implemented pagination API.

**Fix 3 — Compression**: The `compressionMiddleware` gzip-compresses responses above a threshold. Confirm it is active and the threshold (`COMPRESSION_THRESHOLD`) is not set too high.

---

#### Synchronous File or Blocking I/O

**Symptom**: Event loop utilisation is high even at low request rates. `fs.readFileSync` or `crypto.randomBytes` (sync variant) appear in the flame graph.

**Fix**: Replace synchronous calls with their async equivalents:
```typescript
// Bad — blocks the event loop
const key = fs.readFileSync('/path/to/key.pem');

// Good — yields the event loop during I/O
const key = await fs.promises.readFile('/path/to/key.pem');
```

---

#### Connection Pool Exhaustion

**Symptom**: p99 spikes but CPU is low. Grafana shows "DB pool utilisation" near 100 %. The flame graph shows long waits in `ConnectionPool#acquire`.

**Fix**: Increase `POOL_MAX` in `.env`, or reduce the duration of each transaction to release connections faster. See the [Connection Pool](guides/connection-pool.md) guide for tuning advice.

---

#### XDR / Soroban Simulation Latency

**Symptom**: `POST /api/v1/loans` p99 is consistently 2–5× higher than read routes even under low concurrency.

**Cause**: Every loan request submits a Soroban transaction, which involves network round-trips to the RPC node and XDR serialisation.

**Fixes**:
- Ensure `RPC_URL` points to a low-latency endpoint (co-located or regional).
- Cache the result of `simulateTransaction` where the simulation inputs have not changed.
- Increase `TIMEOUT_CONTRACT_MS` conservatively rather than letting requests timeout and retry.

---

### Benchmark Workflow

Follow this workflow whenever you make a change that might affect performance:

1. **Establish a baseline** — run `npm run perf:test` on `main` before your change.
2. **Apply the change** on your branch.
3. **Re-run the benchmark** — `npm run perf:test` on your branch.
4. **Compare results** — check `benchmark-results.json`. p99 should not regress beyond baseline + 20 %.
5. **Update baselines** if the change genuinely improves performance — see [Updating Baselines](#updating-baselines).
6. **Attach results** to the PR as a comment or artifact so reviewers can verify the numbers.

---

## Updating Baselines

After a genuine performance improvement (not a regression), update the baselines so CI stays meaningful:

1. Run `npm run perf:test` and note the new p99 values.
2. Update `BASELINES` in `backend/performance/benchmarks.js`.
3. Update the table in `backend/performance/BASELINES.md`.
4. Commit with a message explaining why the baseline changed.

---

## Related

- [Benchmark README](../backend/performance/README.md)
- [Baselines](../backend/performance/BASELINES.md)
- [Request timeout docs](../backend/docs/REQUEST_TIMEOUT.md)
- [Observability](observability.md)
