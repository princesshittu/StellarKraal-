/**
 * GraphQL resolvers for StellarKraal API v2 (proof-of-concept).
 *
 * All resolvers delegate to the existing service and store layer so that
 * business logic is not duplicated between REST and GraphQL surfaces
 * (see ADR-009 and docs/adr/ADR-009-api-v2-design.md).
 *
 * Query  { loans, loan, collateral, collateralById }
 * Mutation { requestLoan, repayLoan }
 */
import { GraphQLScalarType, Kind } from 'graphql';
import {
  listLoans,
  listCollateral,
  getLoan,
  getCollateral,
} from '../db/store';
import {
  requestLoan,
  repayLoan,
  loanRequestSchema,
  loanRepaySchema,
} from '../services/loanService';
import { GraphQLError } from 'graphql';

/** Custom DateTime scalar — passes through ISO strings unchanged. */
const DateTimeScalar = new GraphQLScalarType({
  name: 'DateTime',
  description: 'ISO-8601 date-time string',
  serialize(value: unknown) {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string') return value;
    throw new GraphQLError(`DateTime cannot represent non-string value: ${value}`);
  },
  parseValue(value: unknown) {
    if (typeof value === 'string') return value;
    throw new GraphQLError(`DateTime cannot parse non-string input: ${value}`);
  },
  parseLiteral(ast) {
    if (ast.kind === Kind.STRING) return ast.value;
    throw new GraphQLError('DateTime expects a string literal');
  },
});

export const resolvers = {
  DateTime: DateTimeScalar,

  Query: {
    /**
     * List loans with optional pagination and filters.
     *
     * Supports two pagination modes:
     * - Offset-based (legacy): supply `page` + `limit`.
     * - Cursor-based (relay-style): supply `cursor` + `limit`.
     *
     * Always returns a `LoanConnection` with relay-style edges and pageInfo
     * regardless of which mode is used.
     */
    loans(
      _parent: unknown,
      args: {
        page?: number;
        limit?: number;
        status?: string;
        borrowerAddress?: string;
        cursor?: string;
      }
    ) {
      const { limit = 20, status, borrowerAddress, cursor } = args;
      const safeLimit = Math.min(Math.max(limit, 1), 100);

      if (cursor) {
        // Cursor-based mode: decode the opaque cursor (base64 ISO date string)
        // and return items created after that timestamp.
        let afterDate: Date;
        try {
          afterDate = new Date(Buffer.from(cursor, 'base64').toString('utf8'));
          if (isNaN(afterDate.getTime())) throw new Error('invalid date');
        } catch {
          throw new GraphQLError('Invalid cursor', {
            extensions: { code: 'BAD_USER_INPUT' },
          });
        }

        // Fetch one extra item to determine hasNextPage
        const pageResult = listLoans({ status, borrowerAddress, page: 1, limit: 10_000 });
        const allLoans = pageResult.data.filter(
          (l) => new Date(l.createdAt) < afterDate
        );
        const sliced = allLoans.slice(0, safeLimit);
        const hasNextPage = allLoans.length > safeLimit;

        const edges = sliced.map((loan) => ({
          cursor: Buffer.from(loan.createdAt).toString('base64'),
          node: loan,
        }));

        return {
          edges,
          pageInfo: {
            hasNextPage,
            endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null,
          },
          totalCount: pageResult.total,
        };
      }

      // Offset-based mode
      const { page = 1 } = args;
      const result = listLoans({ page, limit: safeLimit, status, borrowerAddress });

      const edges = result.data.map((loan) => ({
        cursor: Buffer.from(loan.createdAt).toString('base64'),
        node: loan,
      }));

      const hasNextPage = page * safeLimit < result.total;

      return {
        edges,
        pageInfo: {
          hasNextPage,
          endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null,
        },
        totalCount: result.total,
      };
    },

    /**
     * Fetch a single loan by ID.
     */
    loan(_parent: unknown, args: { id: string }) {
      const record = getLoan(args.id);
      if (!record) return null;
      return record;
    },

    /**
     * List collateral records with optional pagination and owner filter.
     */
    collateral(
      _parent: unknown,
      args: {
        page?: number;
        limit?: number;
        ownerId?: string;
      }
    ) {
      const { page = 1, limit = 20, ownerId } = args;
      return listCollateral({ page, limit, ownerId });
    },

    /**
     * Fetch a single collateral record by ID.
     */
    collateralById(_parent: unknown, args: { id: string }) {
      const record = getCollateral(args.id);
      if (!record) return null;
      return record;
    },
  },

  Mutation: {
    /**
     * Build a request_loan Soroban transaction.
     * Validates input via the shared Zod schema used by the REST endpoint.
     */
    async requestLoan(
      _parent: unknown,
      args: {
        borrower: string;
        collateral_ids: number[];
        amount: number;
        min_disbursement?: number;
      }
    ) {
      const parsed = loanRequestSchema.safeParse(args);
      if (!parsed.success) {
        throw new GraphQLError('Validation failed', {
          extensions: {
            code: 'BAD_USER_INPUT',
            issues: parsed.error.issues,
          },
        });
      }
      return requestLoan(parsed.data);
    },

    /**
     * Build a repay_loan Soroban transaction.
     * Validates input via the shared Zod schema used by the REST endpoint.
     */
    async repayLoan(
      _parent: unknown,
      args: {
        borrower: string;
        loan_id: number;
        amount: number;
      }
    ) {
      const parsed = loanRepaySchema.safeParse(args);
      if (!parsed.success) {
        throw new GraphQLError('Validation failed', {
          extensions: {
            code: 'BAD_USER_INPUT',
            issues: parsed.error.issues,
          },
        });
      }
      return repayLoan(parsed.data);
    },
  },
};
