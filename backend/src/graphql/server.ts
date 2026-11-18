/**
 * Apollo Server v4 setup for StellarKraal GraphQL API v2 (ADR-011, issue #1537).
 *
 * Creates an Apollo Server instance and returns an Express-compatible
 * middleware using expressMiddleware from @apollo/server/express4.
 *
 * Changes for issue #1537:
 *  - Mounted at /api/v2/graphql in addition to the legacy /graphql path
 *  - Per-request DataLoader (loansByBorrowerLoader) added to context for N+1 prevention
 *  - JWT authentication context extracts and validates the wallet address
 *
 * Usage:
 *   const { middleware, server } = await createGraphQLMiddleware();
 *   app.use('/api/v2/graphql', cors(), express.json(), middleware);
 *   // Call server.stop() during graceful shutdown.
 *
 * The GraphQL endpoint lives at /api/v2/graphql and includes the Apollo Sandbox
 * in non-production environments for interactive exploration.
 */
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { typeDefs } from './typeDefs';
import { resolvers, createLoansByBorrowerLoader } from './resolvers';

export interface GraphQLContext {
  /** The authenticated user's public key, if a JWT was presented. */
  userPublicKey?: string;
  /**
   * Per-request DataLoader for batching loan lookups by borrower address.
   * Prevents N+1 queries when resolving User.loans across multiple users.
   */
  loansByBorrowerLoader: ReturnType<typeof createLoansByBorrowerLoader>;
}

/**
 * Build and start an Apollo Server instance, returning an Express middleware
 * and a reference to the server for graceful shutdown.
 *
 * @returns `{ middleware, server }` — mount `middleware` on an Express route.
 */
export async function createGraphQLMiddleware(): Promise<{
  middleware: ReturnType<typeof expressMiddleware<GraphQLContext>>;
  server: ApolloServer<GraphQLContext>;
}> {
  const server = new ApolloServer<GraphQLContext>({
    typeDefs,
    resolvers,
    // Disable introspection in production to reduce attack surface.
    introspection: process.env.NODE_ENV !== 'production',
  });

  await server.start();

  const middleware = expressMiddleware(server, {
    context: async ({ req }) => {
      // Forward the authenticated user from JWT middleware if present.
      const user = (req as any).user as { publicKey?: string } | undefined;
      return {
        userPublicKey: user?.publicKey,
        // Create a fresh DataLoader for each request so cache is not shared
        // across requests and batching is scoped to the current request only.
        loansByBorrowerLoader: createLoansByBorrowerLoader(),
      };
    },
  });

  return { middleware, server };
}
