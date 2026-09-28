# ADR-009: API v2 Design Direction

**Date:** 2026-07-27  
**Status:** Superseded by [ADR-011](ADR-011-graphql-api-v2.md)

## Context

The current StellarKraal backend uses a **RESTful API** (Express + Node.js + TypeScript) with endpoints prefixed `/api/v1`. As the platform evolves, we need to decide whether to continue with REST for v2 or adopt a different paradigm.

The key drivers for this decision:
- **Type safety** between frontend (Next.js/TypeScript) and backend
- **Developer experience** — reducing boilerplate for new endpoints
- **Flexibility** — supporting complex queries (e.g., loan history with nested collateral + appraisals)
- **Ecosystem maturity** — stable tooling, community support, and Stellar/wallet integration compatibility
- **Migration cost** — effort to adopt a new paradigm vs. iterating on REST

Three paradigms are evaluated: **REST** (current), **GraphQL**, and **tRPC**.

## Decision

**Continue with REST for v2**, with the following refinements:
- Adopt **OpenAPI 3.1** spec-first development (documented in `backend/openapi.json`)
- Generate TypeScript client types from OpenAPI using `openapi-typescript`
- Introduce **HATEOAS-style links** in responses where navigation is beneficial (e.g., loan → collateral → appraisals)
- Use **JSON:API conventions** for filtering, sorting, and pagination on collection endpoints

This approach balances type safety improvements, backward compatibility, and low migration cost while maintaining the simplicity and familiarity of REST.

## Alternatives Considered

| Option | Reason not chosen |
|--------|-------------------|
| **GraphQL** | Adds significant runtime complexity (schema resolution, N+1 query problem, caching); overkill for the relatively simple StellarKraal data model; requires separate type generation tooling; frontend would need Apollo Client or similar, increasing bundle size. Stellar wallet libraries (Freighter) work naturally with REST but have no GraphQL-specific integration. |
| **tRPC** | Strong type safety and great DX for monorepos, but StellarKraal is not a monorepo — frontend and backend are separate deployments. tRPC's main advantage (end-to-end TypeScript inference) is diminished when the frontend cannot import backend types directly. Still requires custom serialization for Stellar SDK types (e.g., `xdr.ScVal`). Community is smaller than REST or GraphQL, limiting third-party tooling and examples. |

### Detailed Comparison

#### REST (current + OpenAPI)
**Pros:**
- Already implemented; no migration cost
- HTTP caching (ETags, `Cache-Control`) works out of the box
- Stellar RPC and Freighter wallet use REST-like JSON-RPC; consistent paradigm
- OpenAPI tooling (Swagger UI, type generation) is mature
- Easy to version (`/api/v2`) and deprecate endpoints incrementally

**Cons:**
- Over-fetching/under-fetching requires manual endpoint design
- Type safety between frontend and backend requires code generation
- Boilerplate for validation, error handling, and response envelopes

#### GraphQL
**Pros:**
- Clients request exactly the fields they need (no over-fetching)
- Single endpoint; introspection and tooling (GraphQL Playground, Apollo DevTools)
- Strong typing via SDL (Schema Definition Language)

**Cons:**
- **N+1 query problem** requires DataLoader or manual batching
- **Caching complexity** — REST caching (HTTP headers) doesn't work; requires custom cache keys or Apollo cache
- **Schema-first development** adds overhead for small teams
- **No natural mapping to Stellar SDK** — contract invocations return opaque `xdr.ScVal` that don't serialize cleanly to GraphQL scalars
- **Frontend bundle size** — Apollo Client is ~40KB minified
- **Learning curve** for team members unfamiliar with GraphQL resolvers and schema stitching

#### tRPC
**Pros:**
- End-to-end type safety with zero codegen (frontend imports backend types)
- Minimal boilerplate; procedures are just TypeScript functions
- Built-in input validation via Zod
- Small bundle size (~10KB)

**Cons:**
- **Requires monorepo or shared types package** — StellarKraal frontend and backend are separate deployments; shared types would need to be published as an npm package or manually kept in sync
- **No HTTP caching** — tRPC uses POST requests by default (even for queries), breaking standard REST caching
- **Stellar SDK interop** — still requires custom serialization for Soroban types
- **Smaller community** than REST or GraphQL; fewer examples of Stellar + tRPC integration
- **Not HTTP-semantic** — harder to integrate with non-TypeScript clients (e.g., mobile apps, CLI tools, webhooks)

## Consequences

**Positive:**
- **Incremental improvement** — v2 can adopt OpenAPI + type generation without rewriting the entire backend
- **HTTP semantics** — standard caching, CORS, rate limiting, and observability tools work as expected
- **Wallet compatibility** — Freighter, Albedo, and other Stellar wallets use REST-like patterns; no impedance mismatch
- **Team familiarity** — existing Express + REST patterns are well understood
- **Tooling maturity** — OpenAPI has excellent codegen, validation, and documentation tooling (e.g., `express-openapi-validator`, `openapi-typescript`, Swagger UI)

**Negative / Trade-offs:**
- **No automatic end-to-end type safety** — requires maintaining `openapi.json` and running codegen
- **Over-fetching** on some endpoints — mitigated by sparse fieldsets (`?fields=id,amount,status`) and HATEOAS links for optional related resources
- **Boilerplate** — each endpoint still needs explicit validation, error handling, and response formatting (though `express-openapi-validator` reduces this)

## Implementation Notes

For v2, the following conventions should be adopted:

1. **OpenAPI 3.1 spec** in `backend/openapi.json` — all v2 endpoints documented before implementation
2. **Type generation** — run `openapi-typescript` in CI to generate `frontend/src/types/api.ts`
3. **HATEOAS links** — include `_links` in responses where navigation is useful:
   ```json
   {
     "id": "loan-123",
     "amount": 10000,
     "_links": {
       "self": "/api/v2/loans/loan-123",
       "collateral": "/api/v2/loans/loan-123/collateral",
       "repayments": "/api/v2/loans/loan-123/repayments"
     }
   }
   ```
4. **JSON:API conventions** for collections:
   - Filtering: `?filter[status]=active`
   - Sorting: `?sort=-createdAt`
   - Pagination: `?page[offset]=20&page[limit]=10`
5. **Contract invocation errors** — Soroban errors should be unwrapped and mapped to application error codes (see `docs/api-error-codes.md`)

## Future Reconsideration

This decision should be revisited if:
- The frontend and backend are merged into a monorepo (enabling tRPC)
- Complex, client-driven queries become frequent (suggesting GraphQL)
- A mobile app or third-party API clients emerge that would benefit from GraphQL's introspection

## References

- [OpenAPI Specification](https://spec.openapis.org/oas/v3.1.0)
- [JSON:API](https://jsonapi.org/)
- [HATEOAS (Richardson Maturity Model Level 3)](https://martinfowler.com/articles/richardsonMaturityModel.html)
- [ADR-002: JWT-Based Authentication](ADR-002-jwt-auth.md)
- [API Versioning Strategy](../api-versioning-strategy.md)
