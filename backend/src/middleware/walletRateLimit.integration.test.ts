/**
 * Integration tests for the per-wallet rate limiter on loan endpoints (#1221).
 *
 * Verifies:
 *   - 10 loan submissions per minute are allowed per wallet address
 *   - The 11th request within the window returns HTTP 429
 *   - 429 response includes a Retry-After header
 *   - Counters are keyed by wallet address (two wallets get independent limits)
 *   - IP limit still applies when no wallet address is present
 */
import request from 'supertest';
import express, { Express, Request, Response } from 'express';
import { walletLimiter } from '../middleware/rateLimit';

// ── Test app builder ──────────────────────────────────────────────────────────

/**
 * Creates a minimal Express app with walletLimiter applied to POST /.
 * Optionally injects a wallet address via `req.user.publicKey` to simulate
 * a JWT-authenticated request.
 */
function makeApp(walletAddress?: string, max = 10): Express {
  // Override env for test isolation
  process.env.RATE_LIMIT_WALLET_MAX = String(max);
  process.env.RATE_LIMIT_WALLET_WINDOW = '60000';

  // Re-import to pick up env change
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { walletLimiter: freshLimiter } = require('../middleware/rateLimit') as {
    walletLimiter: ReturnType<typeof import('express-rate-limit').default>;
  };

  const app = express();
  app.set('trust proxy', false);
  app.use(express.json());

  // Inject authenticated user when walletAddress is provided
  if (walletAddress) {
    app.use((req: Request, _res: Response, next) => {
      (req as Request & { user: { publicKey: string } }).user = {
        publicKey: walletAddress,
      };
      next();
    });
  }

  app.post('/', freshLimiter, (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  return app;
}

async function postN(app: Express, n: number): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < n; i++) {
    const res = await request(app).post('/').send({});
    statuses.push(res.status);
  }
  return statuses;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('walletLimiter — per-wallet rate limit on loan endpoints (#1221)', () => {
  const WALLET_A = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV2';
  const WALLET_B = 'GBCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW3';

  // Each test uses its own fresh app instance so counters are isolated.

  describe('authenticated wallet — 10 submissions per minute', () => {
    it('allows exactly 10 requests', async () => {
      const app = makeApp(WALLET_A);
      const statuses = await postN(app, 10);
      expect(statuses.every((s) => s === 200)).toBe(true);
    });

    it('returns 429 on the 11th request', async () => {
      const app = makeApp(WALLET_A);
      const statuses = await postN(app, 11);
      expect(statuses[10]).toBe(429);
    });

    it('429 response includes Retry-After header', async () => {
      const app = makeApp(WALLET_A);
      await postN(app, 10);
      const res = await request(app).post('/').send({});
      expect(res.status).toBe(429);
      expect(res.headers).toHaveProperty('retry-after');
    });

    it('429 response body contains error message', async () => {
      const app = makeApp(WALLET_A);
      await postN(app, 10);
      const res = await request(app).post('/').send({});
      expect(res.status).toBe(429);
      expect(res.body).toHaveProperty('error');
      expect(res.body).toHaveProperty('retryAfter', 60);
    });

    it('RateLimit-Limit header reflects configured max', async () => {
      const app = makeApp(WALLET_A);
      const res = await request(app).post('/').send({});
      expect(res.headers['ratelimit-limit']).toBe('10');
    });
  });

  describe('independent counters per wallet', () => {
    it('wallet A and wallet B have separate counters', async () => {
      // Two separate apps — each with their own counter for their wallet address
      const appA = makeApp(WALLET_A);
      const appB = makeApp(WALLET_B);

      // Exhaust wallet A's limit
      await postN(appA, 10);
      const resA = await request(appA).post('/').send({});
      expect(resA.status).toBe(429);

      // Wallet B's counter is independent — should still succeed
      const resB = await request(appB).post('/').send({});
      expect(resB.status).toBe(200);
    });
  });

  describe('unauthenticated requests — IP-based fallback', () => {
    it('falls back to IP keying when no wallet address is present', async () => {
      // makeApp without a walletAddress — keyGenerator falls back to req.ip
      const app = makeApp(undefined, 5);
      const statuses = await postN(app, 5);
      expect(statuses.every((s) => s === 200)).toBe(true);

      const res = await request(app).post('/').send({});
      expect(res.status).toBe(429);
    });
  });

  describe('walletLimiter export', () => {
    it('is exported as a function (Express middleware)', () => {
      expect(typeof walletLimiter).toBe('function');
    });
  });
});
