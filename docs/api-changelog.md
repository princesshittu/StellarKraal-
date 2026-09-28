# API Changelog

This document tracks all API-level changes: new endpoints, breaking changes, deprecations, and removals. It covers the `/api/v1` surface only. General application changes are in [CHANGELOG.md](../CHANGELOG.md).

> **How to use this document**
> - Each entry references the version it was introduced in and a brief description.
> - **Breaking changes** include a migration guide and a sunset date for the removed behaviour.
> - Consumers who pin to `/api/v1` should review every **Breaking** entry before upgrading.

---

## v1 Endpoint Inventory

All endpoints below were introduced with the initial v1 release unless a later version is noted.

### Authentication

| Method | Path | Introduced | Notes |
|--------|------|-----------|-------|
| `GET` | `/api/auth/challenge` | v1.0.0 | Returns a one-time challenge string for wallet signing |
| `POST` | `/api/auth/login` | v1.0.0 | Submit signed challenge; returns JWT access + refresh token pair |
| `POST` | `/api/auth/refresh` | v1.0.0 | Rotate access token using a valid refresh token |

### Collateral

| Method | Path | Introduced | Notes |
|--------|------|-----------|-------|
| `POST` | `/api/v1/collateral/register` | v1.0.0 | Register livestock as on-chain collateral; returns unsigned XDR |
| `GET` | `/api/v1/collateral` | v1.0.0 | List all collateral items for the authenticated wallet |
| `GET` | `/api/v1/collateral/:id` | v1.0.0 | Retrieve a single collateral record |
| `PATCH` | `/api/v1/collateral/:id` | v1.1.0 | Partially update a collateral record (appraisal value, metadata) |

### Loans

| Method | Path | Introduced | Notes |
|--------|------|-----------|-------|
| `POST` | `/api/v1/loan/request` | v1.0.0 | Request a loan against registered collateral; returns unsigned XDR |
| `GET` | `/api/v1/loan` | v1.0.0 | List all loans for the authenticated wallet; supports cursor-based pagination |
| `GET` | `/api/v1/loan/:id` | v1.0.0 | Retrieve a single loan record |
| `POST` | `/api/v1/loan/repay` | v1.0.0 | Submit a full or partial repayment; returns unsigned XDR |
| `GET` | `/api/v1/loan/:id/summary` | v1.1.0 | Returns a human-readable loan summary including health factor, outstanding balance, and next repayment estimate |

### Health Factor

| Method | Path | Introduced | Notes |
|--------|------|-----------|-------|
| `GET` | `/api/v1/health/:loanId` | v1.0.0 | Returns current health factor for a loan |

### Admin (protected — requires admin JWT role)

| Method | Path | Introduced | Notes |
|--------|------|-----------|-------|
| `POST` | `/api/v1/admin/liquidate` | v1.0.0 | Trigger liquidation for a loan that has breached the threshold |
| `GET` | `/api/v1/admin/loans` | v1.0.0 | List all loans across all wallets |
| `GET` | `/api/v1/admin/collateral` | v1.0.0 | List all collateral across all wallets |

### System

| Method | Path | Introduced | Notes |
|--------|------|-----------|-------|
| `GET` | `/api/health` | v1.0.0 | Basic health check (RPC reachability, DB pool stats) |
| `GET` | `/api/v1/health` | v1.0.0 | Alias for `/api/health` under the versioned prefix |
| `GET` | `/metrics` | v1.0.0 | Prometheus metrics scrape endpoint |
| `GET` | `/api/docs` | v1.0.0 | Swagger UI served from `backend/openapi.json` |

---

## Changelog Entries

Entries are listed newest-first within each version section.

---

### [Unreleased]

_No pending breaking changes or deprecations at this time._

---

### [v1.1.0] — 2026-09-27

**New endpoints**

#### `PATCH /api/v1/collateral/:id`

Allows partial updates to an existing collateral record. Useful when an
appraisal value changes after the initial registration or when metadata
(animal breed, weight, photo URL) needs correction.

**Request body** (all fields optional):

```json
{
  "appraisalValue": 150000,
  "metadata": {
    "breed": "Boer",
    "weightKg": 72
  }
}
```

**Response (200 OK):**

```json
{
  "id": 17,
  "appraisalValue": 150000,
  "updatedAt": "2026-09-27T10:00:00.000Z"
}
```

> **Note:** `PATCH` does not re-trigger on-chain collateral registration. It
> updates the off-chain record only. If the new appraisal value affects an
> active loan's health factor, the health factor is recalculated on the next
> `/api/v1/health/:loanId` call.

---

#### `GET /api/v1/loan/:id/summary`

Returns a human-readable summary of a single loan, aggregating health factor,
outstanding balance, accrued interest, and a next-repayment estimate.

**Response (200 OK):**

```json
{
  "loanId": 42,
  "status": "active",
  "principal": 5000000000,
  "outstandingBalance": 5125000000,
  "accruedInterest": 125000000,
  "healthFactor": 12500,
  "liquidationThreshold": 8000,
  "nextRepaymentEstimate": {
    "dueDate": "2026-10-27T00:00:00.000Z",
    "minimumAmount": 512500000
  }
}
```

All monetary values are in **stroops** (1 XLM = 10,000,000 stroops).
`healthFactor` is in basis points; a value ≥ 10,000 means the loan is safe.

---

**Pagination — cursor-based `GET /api/v1/loan`**

The loan list endpoint now supports cursor-based pagination. The previous
`page`/`pageSize` query parameters are deprecated (they still work but emit a
`Deprecation: true` response header).

| Parameter | Type | Description |
|-----------|------|-------------|
| `cursor` | `string` | Opaque cursor returned in the previous response. Omit for the first page. |
| `limit` | `integer` | Number of records per page (default: 20, max: 100). |

**Response** now includes a `pagination` object:

```json
{
  "loans": [ ... ],
  "pagination": {
    "nextCursor": "eyJpZCI6NDJ9",
    "hasMore": true,
    "limit": 20
  }
}
```

When `hasMore` is `false`, `nextCursor` is `null` and you have reached the
last page. The cursor is an opaque base64-encoded string — treat it as a
black box and do not parse or store it beyond its use as a pagination token.

**Migration from `page`/`pageSize`:**

Replace:
```
GET /api/v1/loan?page=2&pageSize=20
```

With:
```
GET /api/v1/loan?cursor=<nextCursor from previous response>&limit=20
```

The `page`/`pageSize` parameters will be removed in v1.2.0
(target: 2027-01-01).

---

**Response header change**

All v1 responses now include `API-Version: 1.1` (previously `1`).
Consumers that check this header for routing decisions should accept both
values during the transition period.

---

### [v1.0.0] — Initial Release

**New endpoints**

All v1 endpoints listed in the [Endpoint Inventory](#v1-endpoint-inventory) above were introduced in this release.

**Response conventions**

- All write endpoints (`POST`, `PUT`, `DELETE`) that interact with the Soroban smart contract return a JSON body containing an `xdr` field. The client must sign this XDR with Freighter (or equivalent) and submit it to the Stellar network independently.
- All responses include an `API-Version: 1` header.
- Error responses follow the format documented in [docs/api-error-codes.md](./api-error-codes.md).

**Rate limiting**

Per-IP rate limits apply across all tiers (global, auth, write). See [docs/guides/rate-limits.md](./guides/rate-limits.md).

**Authentication**

JWT-based challenge/sign/login flow. Access tokens expire after 15 minutes; refresh tokens are valid for 7 days. See [ADR-002](./adr/ADR-002-jwt-auth.md).

---

## Breaking Change Format

When a breaking change is introduced, it will be documented in the following format:

---

### [vX.Y.0] — YYYY-MM-DD

#### ⚠️ Breaking: `<short title>`

**What changed**

_Describe the old behaviour and the new behaviour._

**Affected endpoints**

- `METHOD /api/vX/path`

**Migration steps**

1. _Step one._
2. _Step two._

**Sunset date**

Old behaviour removed in `vX.Z.0` (target: YYYY-MM-DD). The deprecated endpoint will respond with `410 Gone` after this date.

---

## Deprecation Policy

1. A deprecated endpoint or parameter emits a `Deprecation: true` response header and a `Warning` header indicating the replacement.
2. Deprecated behaviour is maintained for **at least one minor release cycle** (approximately 4 weeks) before removal.
3. Removal is announced in this changelog with a migration guide and a firm sunset date at least 30 days in advance.
4. Removed endpoints return `410 Gone` for 90 days after removal to give lagging consumers a clear error signal.

---

## Versioning Strategy

The full API versioning strategy (when v2 will be introduced, header conventions, parallel version support window) is documented in [docs/api-versioning-strategy.md](./api-versioning-strategy.md) and [docs/api-versioning.md](./api-versioning.md).

---

## Related Documents

- [API Quickstart](./guides/api-quickstart.md) — base URL, authentication, and common operations
- [API Error Codes](./api-error-codes.md) — all HTTP status codes and application error codes
- [Rate Limits](./guides/rate-limits.md) — per-tier limits and retry guidance
- [API Versioning Strategy](./api-versioning-strategy.md) — parallel version support and sunset policy
- [OpenAPI / Swagger UI](http://localhost:3001/api/docs) — auto-generated interactive reference
