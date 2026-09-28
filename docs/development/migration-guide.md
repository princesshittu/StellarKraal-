# Migration Guide

This file covers two categories of migration:

1. **[API v1 → v2 Migration](#api-v1--v2-migration)** — for API consumers upgrading
   their integrations when API v2 ships.
2. **[Database Migration Guide](#database-migration-guide)** — for contributors
   writing and managing Knex schema migrations.

---

# API v1 → v2 Migration

> **Status:** Draft — v2 is currently in design (see [ADR-009](../adr/ADR-009-api-v2-design.md)).
> This guide documents the expected breaking changes based on the accepted design direction.
> All endpoint paths, field names, and examples are subject to change until v2 is released.

**Related docs:**
- [API Versioning Strategy](../api-versioning-strategy.md)
- [API Versioning Policy](../api-versioning.md)
- [ADR-009: API v2 Design Direction](../adr/ADR-009-api-v2-design.md)

---

## Overview

| | v1 | v2 |
|---|---|---|
| **Base path** | `/api/v1` | `/api/v2` |
| **Status** | Active | In design / stub (returns `501`) |
| **Response header** | `API-Version: 1` | `API-Version: 2` |
| **Spec format** | OpenAPI 3.0 | OpenAPI 3.1 (spec-first) |
| **Collection pagination** | `?limit=&offset=` | JSON:API — `?page[offset]=&page[limit]=` |
| **Collection filtering** | Varies by endpoint | JSON:API — `?filter[field]=value` |
| **Collection sorting** | Varies by endpoint | JSON:API — `?sort=-createdAt` |
| **Response envelope** | `{ data: [], meta: {} }` | `{ data: [], meta: {}, _links: {} }` |
| **v1 sunset date** | TBD (≥ 6 months after v2 GA) | — |

---

## Breaking Changes Summary

API v2 adopts **OpenAPI 3.1 spec-first development**, **JSON:API conventions** for
collection endpoints, and **HATEOAS `_links`** in responses. These changes improve
type safety and navigability but require updates to any client that constructs URLs
or parses response bodies directly.

The key breaking changes are:

1. **Base path** changes from `/api/v1` to `/api/v2`.
2. **Pagination query parameters** change from `limit`/`offset` to `page[limit]`/`page[offset]`.
3. **Filter and sort query parameters** change to JSON:API bracket notation.
4. **Response bodies** gain a `_links` object for navigation; the shape of some nested objects changes.
5. **Loan creation endpoint** path and field names change.
6. **Collateral registration endpoint** path changes.
7. **Authentication token refresh** path changes.
8. **Error response shape** gains additional `source` metadata.

---

## Version Matrix: v1 vs v2 Endpoints

| Operation | v1 Endpoint | v2 Endpoint | Notes |
|-----------|-------------|-------------|-------|
| Health check | `GET /api/v1/health` | `GET /api/v2/health` | Response shape unchanged |
| List loans | `GET /api/v1/loans` | `GET /api/v2/loans` | Pagination params change (see below) |
| Get loan | `GET /api/v1/loans/:id` | `GET /api/v2/loans/:id` | Response gains `_links` |
| Request loan | `POST /api/v1/loan/request` | `POST /api/v2/loans` | Path, body field names change |
| Repay loan | `POST /api/v1/loan/:id/repay` | `POST /api/v2/loans/:id/repayments` | Path changes |
| List collateral | `GET /api/v1/collateral` | `GET /api/v2/collateral` | Pagination params change |
| Get collateral | `GET /api/v1/collateral/:id` | `GET /api/v2/collateral/:id` | Response gains `_links` |
| Register collateral | `POST /api/v1/collateral` | `POST /api/v2/collateral` | Body field names change |
| List transactions | `GET /api/v1/transactions` | `GET /api/v2/transactions` | Pagination params change |
| Auth: register | `POST /api/v1/auth/register` | `POST /api/v2/auth/register` | Response shape unchanged |
| Auth: login | `POST /api/v1/auth/login` | `POST /api/v2/auth/login` | Response shape unchanged |
| Auth: refresh | `POST /api/v1/auth/refresh` | `POST /api/v2/auth/tokens/refresh` | Path changes |
| Auth: logout | `POST /api/v1/auth/logout` | `POST /api/v2/auth/logout` | Unchanged |

---

## Changed Endpoints — Before and After

### 1. List loans — pagination

**Before (v1):**

```http
GET /api/v1/loans?limit=10&offset=20
Authorization: Bearer <token>
```

**After (v2):**

```http
GET /api/v2/loans?page[limit]=10&page[offset]=20
Authorization: Bearer <token>
```

**v2 response (new `_links` object and JSON:API pagination in `meta`):**

```json
{
  "data": [
    {
      "id": "loan-123",
      "status": "active",
      "amount": 10000,
      "collateral_id": "col-456",
      "_links": {
        "self": "/api/v2/loans/loan-123",
        "collateral": "/api/v2/collateral/col-456",
        "repayments": "/api/v2/loans/loan-123/repayments"
      }
    }
  ],
  "meta": {
    "total": 142,
    "page": { "offset": 20, "limit": 10 }
  },
  "_links": {
    "self": "/api/v2/loans?page[offset]=20&page[limit]=10",
    "prev": "/api/v2/loans?page[offset]=10&page[limit]=10",
    "next": "/api/v2/loans?page[offset]=30&page[limit]=10"
  }
}
```

---

### 2. Request a loan

**Before (v1):**

```http
POST /api/v1/loan/request
Authorization: Bearer <token>
Content-Type: application/json

{
  "collateral_id": "col-456",
  "amount": 5000
}
```

**After (v2):**

```http
POST /api/v2/loans
Authorization: Bearer <token>
Content-Type: application/json

{
  "collateralId": "col-456",
  "amount": 5000
}
```

Key changes:
- Path: `/api/v1/loan/request` → `/api/v2/loans`
- Field: `collateral_id` (snake_case) → `collateralId` (camelCase, consistent with all v2 body fields)

**v2 response:**

```json
{
  "data": {
    "id": "loan-789",
    "status": "pending",
    "amount": 5000,
    "collateralId": "col-456",
    "createdAt": "2026-09-26T21:55:05Z",
    "_links": {
      "self": "/api/v2/loans/loan-789",
      "collateral": "/api/v2/collateral/col-456"
    }
  }
}
```

---

### 3. Repay a loan

**Before (v1):**

```http
POST /api/v1/loan/loan-789/repay
Authorization: Bearer <token>
Content-Type: application/json

{
  "amount": 2500
}
```

**After (v2):**

```http
POST /api/v2/loans/loan-789/repayments
Authorization: Bearer <token>
Content-Type: application/json

{
  "amount": 2500
}
```

Path change only; body is unchanged.

---

### 4. Register collateral

**Before (v1):**

```http
POST /api/v1/collateral
Authorization: Bearer <token>
Content-Type: application/json

{
  "animal_type": "cattle",
  "quantity": 3,
  "appraised_value": 15000,
  "owner_id": "user-001"
}
```

**After (v2):**

```http
POST /api/v2/collateral
Authorization: Bearer <token>
Content-Type: application/json

{
  "animalType": "cattle",
  "quantity": 3,
  "appraisedValue": 15000,
  "ownerId": "user-001"
}
```

Key change: all body fields use camelCase.

---

### 5. Auth — token refresh

**Before (v1):**

```http
POST /api/v1/auth/refresh
Content-Type: application/json

{
  "refreshToken": "<token>"
}
```

**After (v2):**

```http
POST /api/v2/auth/tokens/refresh
Content-Type: application/json

{
  "refreshToken": "<token>"
}
```

Path change only; body and response are unchanged.

---

### 6. Error response shape

**Before (v1):**

```json
{
  "error": "INVALID_AMOUNT",
  "message": "Loan amount must be positive"
}
```

**After (v2):**

```json
{
  "error": {
    "code": "INVALID_AMOUNT",
    "message": "Loan amount must be positive",
    "source": {
      "pointer": "/data/amount"
    }
  }
}
```

The `source.pointer` field uses a JSON Pointer (RFC 6901) to identify the specific
request field that caused the error. Clients that pattern-match on the v1 `error`
string must update to `error.code`.

See [docs/api-error-codes.md](../api-error-codes.md) for the full code reference.

---

## New Authentication Flow (if applicable)

v2 does not introduce a new authentication mechanism. JWT-based auth as described
in [docs/auth-flow.md](../auth-flow.md) and [ADR-002](../adr/ADR-002-jwt-auth.md)
remains unchanged. The only auth-related change is the token refresh endpoint path
(see above).

If a new auth flow is introduced before v2 GA, this section will be updated with
before/after examples and a migration checklist.

---

## New Deprecation Headers in v1

Starting from the v2 announcement date, v1 endpoints will return deprecation
headers on every response:

```http
Deprecation: true
Sunset: Sat, 26 Sep 2027 00:00:00 GMT
Warning: 299 - "API v1 is deprecated. Migrate to /api/v2. See docs/development/migration-guide.md"
Link: </api/v2/loans>; rel="successor-version"
```

Log these headers in your integration and alert on them in production to ensure
you migrate before the sunset date.

---

## Client Migration Checklist

- [ ] Update the base URL in your HTTP client from `/api/v1` to `/api/v2`.
- [ ] Update pagination parameters: `limit`/`offset` → `page[limit]`/`page[offset]`.
- [ ] Update filter parameters to bracket notation: `?filter[status]=active`.
- [ ] Update sort parameters: `?sort=-createdAt` (prefix `-` for descending).
- [ ] Update `POST /api/v1/loan/request` → `POST /api/v2/loans`.
- [ ] Update `POST /api/v1/loan/:id/repay` → `POST /api/v2/loans/:id/repayments`.
- [ ] Update `POST /api/v1/auth/refresh` → `POST /api/v2/auth/tokens/refresh`.
- [ ] Update request body fields from snake_case to camelCase for loans and collateral.
- [ ] Update error handling: read `error.code` instead of `error` (string).
- [ ] Update integration tests to use `/api/v2` URLs.
- [ ] Remove reliance on the deprecated `?limit=`/`?offset=` parameters.
- [ ] Verify `API-Version: 2` header is present in responses.

---

# Database Migration Guide

## Overview
This guide explains how to write and manage database migrations in StellarKraal-.

## Migration Structure

### File Naming Convention
```typescript
export async function up(knex: Knex): Promise<void> {
  // Create table
  await knex.schema.createTable('table_name', (table) => {
    // Column definitions
    table.uuid('id').primary();
    table.string('column_name').notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Or alter table
  await knex.schema.alterTable('table_name', (table) => {
    table.string('new_column').nullable();
  });

  // Or insert data
  await knex('table_name').insert([
    { id: 'uuid', name: 'example' }
  ]);
}
export async function down(knex: Knex): Promise<void> {
  // Drop table
  await knex.schema.dropTable('table_name');

  // Or revert alter
  await knex.schema.alterTable('table_name', (table) => {
    table.dropColumn('new_column');
  });

  // Or delete data
  await knex('table_name').where('id', 'uuid').delete();
}
```

### Soft Delete Pattern

```typescript
// Add soft-delete columns
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (table) => {
    table.timestamp('deleted_at').nullable();
    table.index('deleted_at');
  });
}

// Soft delete query
await knex('users')
  .where('id', userId)
  .update({ deleted_at: knex.fn.now() });

// Exclude soft-deleted records
await knex('users')
  .whereNull('deleted_at');

// Include soft-deleted records
await knex('users')
  .whereNotNull('deleted_at');

// Hard delete (permanent)
await knex('users')
  .where('id', userId)
  .delete();
```

### Helper pattern

```typescript
// Create helper functions
const withSoftDelete = (query, includeDeleted = false) => {
  if (!includeDeleted) {
    return query.whereNull('deleted_at');
  }
  return query;
};

// Usage
await withSoftDelete(knex('users'))
  .select('*')
  .where('role', 'admin');
```

### Testing migrations

```typescript
// __tests__/migrations/migration.test.ts

import { Knex } from 'knex';
import { up, down } from '../../migrations/20240101000000_create_users_table';

describe('Migration: create_users_table', () => {
  let knex: Knex;

  beforeAll(async () => {
    // Setup test database
    knex = require('knex')({
      client: 'pg',
      connection: process.env.TEST_DATABASE_URL
    });
  });

  afterAll(async () => {
    await knex.destroy();
  });

  it('should create users table', async () => {
    await up(knex);

    const exists = await knex.schema.hasTable('users');
    expect(exists).toBe(true);

    const columns = await knex('users').columnInfo();
    expect(columns).toHaveProperty('id');
    expect(columns).toHaveProperty('email');
    expect(columns).toHaveProperty('password_hash');
    expect(columns).toHaveProperty('full_name');
  });

  it('should drop users table', async () => {
    await down(knex);

    const exists = await knex.schema.hasTable('users');
    expect(exists).toBe(false);
  });
});
```

### Integration tests

```typescript
// __tests__/integration/migrations.test.ts

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

describe('Migrations', () => {
  it('should run migrations successfully', async () => {
    const { stdout, stderr } = await execAsync(
      'NODE_ENV=test npx knex migrate:latest'
    );
    expect(stderr).toBe('');
    expect(stdout).toContain('Batch 1 run');
  });

  it('should rollback migrations successfully', async () => {
    const { stdout, stderr } = await execAsync(
      'NODE_ENV=test npx knex migrate:rollback'
    );
    expect(stderr).toBe('');
    expect(stdout).toContain('Rolled back');
  });
});
```

### Migration file template

```typescript
// migrations/YYYYMMDDHHMMSS_description.ts

import { Knex } from 'knex';

/**
 * Description of migration
 *
 * Up: Creates table_name with columns
 * Down: Drops table_name
 */
export async function up(knex: Knex): Promise<void> {
  // Apply changes
}

export async function down(knex: Knex): Promise<void> {
  // Revert changes
}
```

### Full example with soft-delete and triggers

```typescript
// migrations/YYYYMMDDHHMMSS_create_table_name.ts

import { Knex } from 'knex';

/**
 * Create table_name table with soft-delete support
 *
 * Up: Creates table_name table
 * Down: Drops table_name table
 */
export async function up(knex: Knex): Promise<void> {
  // Create table
  await knex.schema.createTable('table_name', (table) => {
    // Primary key
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    // Foreign keys
    table.uuid('user_id').references('id').inTable('users');

    // Columns
    table.string('name').notNullable();
    table.text('description');
    table.jsonb('metadata').defaultTo('{}');
    table.enum('status', ['active', 'inactive', 'pending'])
      .defaultTo('pending');

    // Timestamps
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    // Soft-delete
    table.timestamp('deleted_at').nullable();

    // Indexes
    table.index('user_id');
    table.index('status');
    table.index('deleted_at');
  });

  // Add triggers for updated_at
  await knex.raw(`
    CREATE TRIGGER update_table_name_updated_at
    BEFORE UPDATE ON table_name
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Drop trigger
  await knex.raw('DROP TRIGGER IF EXISTS update_table_name_updated_at ON table_name');

  // Drop table
  await knex.schema.dropTable('table_name');
}
```

### Migration lock and status commands

```bash
# Force unlock migration lock
knex migrate:unlock

# Check for unfinished migrations
knex migrate:status

# Rollback specific batch
knex migrate:rollback --batch=1

# Rollback all migrations
knex migrate:rollback --all
```
