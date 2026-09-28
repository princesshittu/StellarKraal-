/**
 * GraphQL proof-of-concept tests (ADR-009 / issue #1076, #1220).
 *
 * Uses ApolloServer's built-in executeOperation() for isolated unit testing
 * of schema, resolvers, and validation without an HTTP server.
 *
 * The stellar SDK and contract services are mocked so this suite runs without
 * a live Soroban RPC connection (consistent with the rest of the unit tests).
 *
 * Changes in #1220:
 * - loans query now returns LoanConnection (cursor-based + offset-based)
 * - JWT auth middleware added to /graphql route (tested at integration level)
 */

// ── Mocks (must be declared before module imports) ─────────────────────────

jest.mock('../services/loanService', () => ({
  loanRequestSchema: {
    safeParse: jest.fn((input: Record<string, unknown>) => {
      // Minimal validation: borrower must start with G and be 56 chars
      const b = input.borrower as string;
      if (!b || !/^G[A-Z2-7]{55}$/.test(b)) {
        return { success: false, error: { issues: [{ message: 'Invalid borrower' }] } };
      }
      return { success: true, data: input };
    }),
  },
  loanRepaySchema: {
    safeParse: jest.fn((input: Record<string, unknown>) => {
      const b = input.borrower as string;
      if (!b || !/^G[A-Z2-7]{55}$/.test(b)) {
        return { success: false, error: { issues: [{ message: 'Invalid borrower' }] } };
      }
      return { success: true, data: input };
    }),
  },
  requestLoan: jest.fn().mockResolvedValue({ xdr: 'mock-request-xdr' }),
  repayLoan: jest.fn().mockResolvedValue({ xdr: 'mock-repay-xdr' }),
}));

// ── Imports ────────────────────────────────────────────────────────────────

import { ApolloServer } from '@apollo/server';
import { typeDefs } from './typeDefs';
import { resolvers } from './resolvers';
import * as store from '../db/store';

const VALID_BORROWER = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV2';

describe('GraphQL PoC', () => {
  let server: ApolloServer;

  beforeAll(async () => {
    server = new ApolloServer({ typeDefs, resolvers });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  // ── Query: loans (LoanConnection) ─────────────────────────────────────────

  describe('Query.loans', () => {
    it('returns a LoanConnection with edges, pageInfo, and totalCount', async () => {
      const result = await server.executeOperation({
        query: `
          query {
            loans {
              edges { cursor node { id borrower amount status } }
              pageInfo { hasNextPage endCursor }
              totalCount
            }
          }
        `,
      });

      expect(result.body.kind).toBe('single');
      const body = result.body as { kind: 'single'; singleResult: { data?: unknown; errors?: unknown[] } };
      expect(body.singleResult.errors).toBeUndefined();
      const data = body.singleResult.data as {
        loans: {
          edges: { cursor: string; node: unknown }[];
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          totalCount: number;
        };
      };
      expect(data.loans.edges).toBeInstanceOf(Array);
      expect(data.loans.totalCount).toBeGreaterThanOrEqual(0);
      expect(typeof data.loans.pageInfo.hasNextPage).toBe('boolean');
    });

    it('returns loans matching a status filter', async () => {
      store.insertLoan({
        id: 'gql-test-1',
        borrower: 'GABC',
        collateral_id: 'c1',
        amount: 500,
        status: 'active',
      });

      const result = await server.executeOperation({
        query: `
          query {
            loans(status: active) {
              edges { node { id status } }
              totalCount
            }
          }
        `,
      });

      const body = result.body as {
        kind: 'single';
        singleResult: { data?: unknown; errors?: unknown[] };
      };
      expect(body.singleResult.errors).toBeUndefined();
      const data = body.singleResult.data as {
        loans: { edges: { node: { id: string; status: string } }[]; totalCount: number };
      };
      expect(data.loans.edges.some((e) => e.node.id === 'gql-test-1')).toBe(true);
    });

    it('returns cursor-based results when cursor arg is provided', async () => {
      // Insert a loan to ensure there is at least one result
      store.insertLoan({
        id: 'gql-cursor-1',
        borrower: 'GCURSOR',
        collateral_id: 'cc1',
        amount: 100,
        status: 'active',
      });

      // First fetch without cursor to get endCursor
      const first = await server.executeOperation({
        query: `
          query {
            loans(limit: 100) {
              edges { cursor node { id } }
              pageInfo { endCursor hasNextPage }
            }
          }
        `,
      });

      const firstBody = first.body as {
        kind: 'single';
        singleResult: { data?: unknown; errors?: unknown[] };
      };
      expect(firstBody.singleResult.errors).toBeUndefined();
      const firstData = firstBody.singleResult.data as {
        loans: {
          edges: { cursor: string; node: { id: string } }[];
          pageInfo: { endCursor: string | null };
        };
      };

      // If there's at least one loan, use the cursor to get the next page
      if (firstData.loans.edges.length > 0) {
        const endCursor = firstData.loans.pageInfo.endCursor;
        const second = await server.executeOperation({
          query: `
            query NextPage($cursor: String!) {
              loans(cursor: $cursor, limit: 10) {
                edges { node { id } }
                pageInfo { hasNextPage endCursor }
                totalCount
              }
            }
          `,
          variables: { cursor: endCursor },
        });

        const secondBody = second.body as {
          kind: 'single';
          singleResult: { data?: unknown; errors?: unknown[] };
        };
        expect(secondBody.singleResult.errors).toBeUndefined();
        const secondData = secondBody.singleResult.data as {
          loans: { edges: unknown[]; totalCount: number };
        };
        // After the last item there should be no more results
        expect(secondData.loans.edges).toBeInstanceOf(Array);
      }
    });

    it('throws BAD_USER_INPUT for a malformed cursor', async () => {
      const result = await server.executeOperation({
        query: `
          query {
            loans(cursor: "not-valid-base64-date!!!") {
              edges { node { id } }
            }
          }
        `,
      });

      const body = result.body as {
        kind: 'single';
        singleResult: { errors?: { extensions?: { code?: string } }[] };
      };
      expect(body.singleResult.errors).toBeDefined();
      expect(body.singleResult.errors![0].extensions?.code).toBe('BAD_USER_INPUT');
    });
  });

  // ── Query: collateral ──────────────────────────────────────────────────────

  describe('Query.collateral', () => {
    it('returns a CollateralPage', async () => {
      const result = await server.executeOperation({
        query: `
          query {
            collateral {
              data { id owner animal_type count appraised_value }
              total
              page
              limit
            }
          }
        `,
      });

      const body = result.body as {
        kind: 'single';
        singleResult: { data?: unknown; errors?: unknown[] };
      };
      expect(body.singleResult.errors).toBeUndefined();
      const data = body.singleResult.data as {
        collateral: { data: unknown[]; total: number };
      };
      expect(data.collateral.data).toBeInstanceOf(Array);
    });

    it('filters collateral by ownerId', async () => {
      store.insertCollateral({
        id: 'col-gql-1',
        owner: 'GOWNER1',
        animal_type: 'cattle',
        count: 3,
        appraised_value: 300_000,
        status: 'available',
      });

      const result = await server.executeOperation({
        query: `
          query {
            collateral(ownerId: "GOWNER1") {
              data { id owner }
              total
            }
          }
        `,
      });

      const body = result.body as {
        kind: 'single';
        singleResult: { data?: unknown; errors?: unknown[] };
      };
      expect(body.singleResult.errors).toBeUndefined();
      const data = body.singleResult.data as {
        collateral: { data: { id: string; owner: string }[]; total: number };
      };
      expect(data.collateral.data.every((c) => c.owner === 'GOWNER1')).toBe(true);
    });
  });

  // ── Query: loan by ID ──────────────────────────────────────────────────────

  describe('Query.loan', () => {
    it('returns null for a non-existent loan', async () => {
      const result = await server.executeOperation({
        query: `query { loan(id: "nonexistent") { id } }`,
      });

      const body = result.body as {
        kind: 'single';
        singleResult: { data?: unknown; errors?: unknown[] };
      };
      expect(body.singleResult.errors).toBeUndefined();
      const data = body.singleResult.data as { loan: null };
      expect(data.loan).toBeNull();
    });

    it('returns a loan by ID', async () => {
      store.insertLoan({
        id: 'gql-test-2',
        borrower: 'GDEF',
        collateral_id: 'c2',
        amount: 300,
        status: 'active',
      });

      const result = await server.executeOperation({
        query: `query { loan(id: "gql-test-2") { id borrower amount } }`,
      });

      const body = result.body as {
        kind: 'single';
        singleResult: { data?: unknown; errors?: unknown[] };
      };
      expect(body.singleResult.errors).toBeUndefined();
      const data = body.singleResult.data as {
        loan: { id: string; borrower: string; amount: number };
      };
      expect(data.loan?.id).toBe('gql-test-2');
      expect(data.loan?.borrower).toBe('GDEF');
    });
  });

  // ── Query: collateralById ─────────────────────────────────────────────────

  describe('Query.collateralById', () => {
    it('returns null for a non-existent collateral record', async () => {
      const result = await server.executeOperation({
        query: `query { collateralById(id: "missing-id") { id } }`,
      });

      const body = result.body as {
        kind: 'single';
        singleResult: { data?: unknown; errors?: unknown[] };
      };
      expect(body.singleResult.errors).toBeUndefined();
      const data = body.singleResult.data as { collateralById: null };
      expect(data.collateralById).toBeNull();
    });
  });

  // ── Mutation: requestLoan ─────────────────────────────────────────────────

  describe('Mutation.requestLoan', () => {
    it('returns BAD_USER_INPUT for an invalid borrower address', async () => {
      const result = await server.executeOperation({
        query: `
          mutation {
            requestLoan(
              borrower: "NOT_A_VALID_KEY"
              collateral_ids: [1]
              amount: 1000
            ) { xdr }
          }
        `,
      });

      const body = result.body as {
        kind: 'single';
        singleResult: {
          data?: unknown;
          errors?: { extensions?: { code?: string } }[];
        };
      };
      expect(body.singleResult.errors).toBeDefined();
      expect(body.singleResult.errors![0].extensions?.code).toBe('BAD_USER_INPUT');
    });

    it('returns xdr for a valid request', async () => {
      const result = await server.executeOperation({
        query: `
          mutation {
            requestLoan(
              borrower: "${VALID_BORROWER}"
              collateral_ids: [1]
              amount: 1000
            ) { xdr }
          }
        `,
      });

      const body = result.body as {
        kind: 'single';
        singleResult: { data?: unknown; errors?: unknown[] };
      };
      expect(body.singleResult.errors).toBeUndefined();
      const data = body.singleResult.data as { requestLoan: { xdr: string } };
      expect(typeof data.requestLoan.xdr).toBe('string');
    });
  });

  // ── Mutation: repayLoan ───────────────────────────────────────────────────

  describe('Mutation.repayLoan', () => {
    it('returns BAD_USER_INPUT for an invalid borrower address', async () => {
      const result = await server.executeOperation({
        query: `
          mutation {
            repayLoan(
              borrower: "NOT_A_VALID_KEY"
              loan_id: 1
              amount: 100
            ) { xdr }
          }
        `,
      });

      const body = result.body as {
        kind: 'single';
        singleResult: {
          data?: unknown;
          errors?: { extensions?: { code?: string } }[];
        };
      };
      expect(body.singleResult.errors).toBeDefined();
      expect(body.singleResult.errors![0].extensions?.code).toBe('BAD_USER_INPUT');
    });

    it('returns xdr for a valid repayment', async () => {
      const result = await server.executeOperation({
        query: `
          mutation {
            repayLoan(
              borrower: "${VALID_BORROWER}"
              loan_id: 1
              amount: 100
            ) { xdr }
          }
        `,
      });

      const body = result.body as {
        kind: 'single';
        singleResult: { data?: unknown; errors?: unknown[] };
      };
      expect(body.singleResult.errors).toBeUndefined();
      const data = body.singleResult.data as { repayLoan: { xdr: string } };
      expect(typeof data.repayLoan.xdr).toBe('string');
    });
  });
});
