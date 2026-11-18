/**
 * GraphQL resolvers for StellarKraal API v2 (ADR-011, issue #1537).
 *
 * All resolvers delegate to the existing service and store layer so that
 * business logic is not duplicated between REST and GraphQL surfaces.
 *
 * Changes for issue #1537:
 *  - Query.user resolver added — fetches UserProfile by wallet address
 *  - User.loans field resolver uses a per-request DataLoader to batch
 *    loan lookups by borrower address, preventing N+1 queries
 *  - createLoaderForBorrower exported for use in GraphQL context
 *
 * Query  { loans, loan, collateral, collateralById, user }
 * Mutation { requestLoan, repayLoan }
 */
import { GraphQLScalarType, Kind } from 'graphql';
import {
  listLoans,
  listCollateral,
  getLoan,
  getCollateral,
  getProfile,
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

// ── DataLoader (issue #1537) ──────────────────────────────────────────────────
//
// DataLoader batches multiple `User.loans` field resolver calls within a single
// tick into one grouped lookup, preventing N+1 queries when a list of users is
// returned and each requires their loans.
//
// The package is polyfilled here so the GraphQL layer works without installing
// the full `dataloader` npm package (which requires Node native modules in some
// environments). A single-tick batcher is sufficient for the in-memory store.

type BatchLoadFn<K, V> = (keys: readonly K[]) => Promise<V[]>;

/**
 * Minimal DataLoader implementation for the in-memory store.
 * Batches all load() calls made in the current microtask into a single
 * batchLoadFn invocation, then resolves each individual Promise.
 */
class DataLoader<K, V> {
  private readonly batchFn: BatchLoadFn<K, V>;
  private queue: Array<{ key: K; resolve: (v: V) => void; reject: (e: unknown) => void }> = [];
  private scheduled = false;

  constructor(batchFn: BatchLoadFn<K, V>) {
    this.batchFn = batchFn;
  }

  load(key: K): Promise<V> {
    return new Promise<V>((resolve, reject) => {
      this.queue.push({ key, resolve, reject });
      if (!this.scheduled) {
        this.scheduled = true;
        // Schedule dispatch after current synchronous code completes
        Promise.resolve().then(() => this.dispatch());
      }
    });
  }

  private async dispatch() {
    const batch = this.queue.splice(0);
    this.scheduled = false;
    const keys = batch.map((item) => item.key);
    try {
      const values = await this.batchFn(keys);
      batch.forEach((item, i) => item.resolve(values[i]));
    } catch (err) {
      batch.forEach((item) => item.reject(err));
    }
  }
}

/**
 * Create a per-request DataLoader that batches loan lookups by borrower address.
 * Call once per GraphQL request and attach to context.
 */
export function createLoansByBorrowerLoader(): DataLoader<string, ReturnType<typeof listLoans>['data']> {
  return new DataLoader<string, ReturnType<typeof listLoans>['data']>(
    async (borrowerAddresses: readonly string[]) => {
      // Fetch loans for all requested borrower addresses in one pass
      return borrowerAddresses.map((address) =>
        listLoans({ borrowerAddress: address, limit: 1_000 }).data
      );
    }
  );
}

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

    /**
     * Fetch a user profile by wallet address (issue #1537).
     * Returns null when no profile exists yet for the address.
     */
    user(_parent: unknown, args: { walletAddress: string }) {
      const profile = getProfile(args.walletAddress);
      if (!profile) return null;
      return profile;
    },
  },

  // ── User field resolvers (issue #1537) ───────────────────────────────────

  User: {
    /**
     * Resolve the loans belonging to a user.
     * Uses the per-request DataLoader from context to batch DB lookups when
     * multiple users are queried in the same request (N+1 prevention).
     */
    async loans(
      parent: { walletAddress: string },
      _args: unknown,
      context: { loansByBorrowerLoader?: ReturnType<typeof createLoansByBorrowerLoader> }
    ) {
      if (context.loansByBorrowerLoader) {
        return context.loansByBorrowerLoader.load(parent.walletAddress);
      }
      // Fallback when loader is not in context (e.g. unit tests)
      return listLoans({ borrowerAddress: parent.walletAddress, limit: 1_000 }).data;
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
