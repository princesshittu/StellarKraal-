# ADR-011: GraphQL as the API v2 Query Layer

**Date:** 2026-09-27  
**Status:** Accepted

## Context

[ADR-009](ADR-009-api-v2-design.md) evaluated three paradigms for the StellarKraal API v2 (REST, GraphQL, tRPC) and initially proposed continuing with REST enhanced by OpenAPI 3.1. That decision was marked **Proposed** and was never formally merged as **Accepted**.

Subsequent development experience surfaced concrete pain points that shifted the evaluation:

- The frontend makes 3–5 sequential REST calls to compose a single loan detail view (loan → collateral → appraisals → repayment history → health factor), causing waterfall latency and over-fetching.
- Adding new views requires new backend endpoints or expanding existing response shapes, slowing frontend iteration.
- Consumer-driven contracts (the frontend's exact field requirements) diverged from what the REST endpoints return, requiring manual coordination on every API change.
- tRPC was re-evaluated and ruled out because the frontend and backend remain separate deployments with no shared module resolution path, making its primary advantage (zero-codegen type safety) unavailable without publishing a separate npm types package.

GraphQL directly addresses the over-fetching and waterfall problems that motivated the v2 effort, and its ecosystem has matured significantly since the original ADR-009 evaluation.

## Decision

We will adopt **GraphQL** as the query layer for API v2, implemented with:

- **[GraphQL Yoga](https://the-guild.dev/graphql/yoga-server)** as the server (lightweight, framework-agnostic, runs on Express).
- **[Pothos](https://pothos-graphql.dev/)** (code-first schema builder) for TypeScript-native schema definitions — no separate SDL file to keep in sync.
- **[DataLoader](https://github.com/graphql/dataloader)** for request-scoped batching of database lookups, eliminating the N+1 query problem.
- **[graphql-codegen](https://the-guild.dev/graphql/codegen)** to generate typed React hooks for the Next.js frontend from the schema, replacing manual `openapi-typescript` codegen.

The existing v1 REST endpoints remain untouched and will be maintained through the end of the deprecation window defined in the migration plan below.

## Alternatives Considered

| Option | Reason not chosen |
|--------|-------------------|
| **REST + OpenAPI 3.1 (ADR-009 proposal)** | Does not solve the waterfall fetching problem. Over-fetching still requires bespoke `?fields=` or `?include=` parameters on every endpoint. Type generation from OpenAPI is accurate only when `openapi.json` is kept up-to-date manually, which proved unreliable in practice. |
| **tRPC** | Requires the frontend and backend to share a TypeScript module (monorepo or published package). StellarKraal frontend and backend are separately deployed; the shared-types package approach adds a publishing and versioning burden that outweighs tRPC's DX benefits. Not considered further. |
| **JSON:API over REST** | A convention layer on top of REST that solves filtering, sorting, and sparse fieldsets. Still does not eliminate waterfall requests for deeply nested resources. Adds unfamiliar conventions without the ecosystem tooling of GraphQL. |
| **gRPC / gRPC-Web** | Excellent for inter-service communication but has limited browser support, requires Protobuf schemas, and has minimal overlap with the Stellar wallet ecosystem. Overkill for a consumer-facing API. |

## Consequences

**Positive:**
- **Single round-trip for complex views** — the loan detail page can fetch loan, collateral, appraisals, repayment history, and health factor in one GraphQL query.
- **No over-fetching** — the frontend declares exactly which fields it needs; the server resolves only those.
- **Code-first, TypeScript-native schema** — Pothos generates the SDL from TypeScript types, keeping the schema and resolver types in sync without a separate code-generation step in the backend.
- **Generated frontend hooks** — `graphql-codegen` produces typed `useQuery`/`useMutation` hooks for every operation, giving the frontend compile-time safety equivalent to tRPC for the declared operations.
- **Introspection and tooling** — GraphQL Playground / Apollo Sandbox provides interactive API exploration for developers and QA without a separate Swagger UI deployment.
- **Incremental adoption** — GraphQL Yoga can be mounted at `/api/v2/graphql` alongside the existing Express app; no big-bang migration required.
- **DataLoader batching** — eliminates the N+1 query problem that was the primary technical risk identified in ADR-009, with request-scoped caching included.

**Negative / Trade-offs:**
- **HTTP caching does not apply** — GraphQL queries use POST; standard `Cache-Control` / ETag caching at the CDN or proxy layer does not work. Per-field caching must be handled at the resolver or DataLoader level, or via a persisted-query cache (e.g., GraphQL Yoga's `useResponseCache` plugin). This adds operational complexity compared to REST.
- **N+1 risk requires discipline** — DataLoader solves N+1 only when resolvers are written to use it. Code review must enforce DataLoader usage for any resolver that performs a per-entity database lookup.
- **Schema governance** — breaking schema changes (removing or renaming fields) are invisible to REST consumers and must be managed via the `@deprecated` directive and a schema linting step in CI (`graphql-inspector` or `graphql-schema-linter`).
- **Bundle size** — the frontend will add a lightweight GraphQL client. We will use **[URQL](https://formidable.com/open-source/urql/)** (~10 KB min+gzip) instead of Apollo Client (~40 KB) to minimise the bundle impact.
- **Stellar SDK serialisation** — Soroban `xdr.ScVal` types must be mapped to GraphQL scalars or custom types. A `JSON` scalar will be used for opaque contract data; structured types (amounts, addresses) will be explicit scalar types (`StellarAddress`, `Stroops`).
- **Learning curve** — team members unfamiliar with GraphQL resolvers, the Pothos schema builder, and DataLoader patterns will need onboarding. Documentation and a starter guide will be added to `docs/development/`.
- **REST v1 migration** — v1 REST endpoints must be maintained in parallel until a deprecation date is announced. Deprecation notices will be added to the OpenAPI spec and communicated via `Sunset` response headers.

## Migration Plan

1. **Phase 1 — Foundation** (spike, 1 week): Mount GraphQL Yoga at `/api/v2/graphql`. Define the Pothos schema for `Loan`, `Collateral`, and `Appraisal` types. Wire DataLoader for loan-by-ID and collateral-by-loan-ID lookups. Add `graphql-codegen` to the frontend CI step.
2. **Phase 2 — Loan detail view** (1–2 weeks): Migrate the loan detail page to a single GraphQL query. Validate round-trip latency against the current REST waterfall baseline.
3. **Phase 3 — Full v2 surface** (3–4 weeks): Cover all remaining v1 endpoints in the GraphQL schema. Add mutations for loan request, repayment, and collateral registration.
4. **Phase 4 — Deprecation** (post-launch): Add `Sunset` headers to v1 REST responses. Announce a deprecation date (minimum 6 months after Phase 3 GA). Remove v1 endpoints after the sunset date.

## References

- [ADR-009: API v2 Design Direction](ADR-009-api-v2-design.md) — superseded by this ADR
- [GraphQL Yoga](https://the-guild.dev/graphql/yoga-server)
- [Pothos GraphQL](https://pothos-graphql.dev/)
- [DataLoader](https://github.com/graphql/dataloader)
- [graphql-codegen](https://the-guild.dev/graphql/codegen)
- [URQL](https://formidable.com/open-source/urql/)
- [graphql-inspector](https://the-guild.dev/graphql/inspector) — schema diffing and breaking-change detection
- [ADR-002: JWT-Based Authentication](ADR-002-jwt-auth.md) — auth strategy remains unchanged
