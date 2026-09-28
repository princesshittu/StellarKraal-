import rateLimit from "express-rate-limit";
import { Request, Response } from "express";

const windowMs = 60 * 1000; // 1 minute

const handler = (_req: Request, res: Response) => {
  res.setHeader("Retry-After", "60");
  res.status(429).json({ error: "Too many requests", retryAfter: 60 });
};

export const authLimiter = rateLimit({
  windowMs,
  max: parseInt(process.env.RATE_LIMIT_AUTH ?? "10", 10),
  standardHeaders: true,
  legacyHeaders: false,
  handler,
});

export const readLimiter = rateLimit({
  windowMs,
  max: parseInt(process.env.RATE_LIMIT_READ ?? "100", 10),
  standardHeaders: true,
  legacyHeaders: false,
  handler,
});

export const globalLimiter = rateLimit({
  windowMs,
  max: parseInt(process.env.RATE_LIMIT_GLOBAL ?? "60", 10),
  standardHeaders: true,
  legacyHeaders: false,
  handler,
});

export const writeLimiter = rateLimit({
  windowMs,
  max: parseInt(process.env.RATE_LIMIT_WRITE ?? "10", 10),
  standardHeaders: true,
  legacyHeaders: false,
  handler,
});

/**
 * Per-wallet rate limiter for loan submission endpoints (#1221).
 *
 * Limits each authenticated wallet address to 10 loan submissions per minute.
 * Falls back to the request IP for unauthenticated requests so the IP-based
 * limit still applies on unprotected routes.
 *
 * Store: in-memory (express-rate-limit default).  For production with multiple
 * instances, replace with a Redis store (e.g. `rate-limit-redis`).
 *
 * Configuration via environment variables:
 *   RATE_LIMIT_WALLET_MAX     — max requests per window (default: 10)
 *   RATE_LIMIT_WALLET_WINDOW  — window in ms (default: 60000)
 */
export const walletLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WALLET_WINDOW ?? String(windowMs), 10),
  max: parseInt(process.env.RATE_LIMIT_WALLET_MAX ?? "10", 10),
  standardHeaders: true,
  legacyHeaders: false,
  // Key is the authenticated wallet public key; fall back to IP
  keyGenerator: (req: Request): string => {
    const user = (req as Request & { user?: { publicKey?: string } }).user;
    return user?.publicKey ?? (req.ip ?? "unknown");
  },
  handler: (_req: Request, res: Response) => {
    res.setHeader("Retry-After", "60");
    res.status(429).json({
      error: "Too many loan submissions. Please wait before trying again.",
      retryAfter: 60,
    });
  },
});
