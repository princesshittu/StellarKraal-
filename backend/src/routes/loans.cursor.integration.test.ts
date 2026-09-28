/**
 * Integration tests for cursor-based pagination on GET /api/v1/loans.
 * Closes #1219
 */
import request from "supertest";
import express, { Express } from "express";

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  createRequestLogger: jest.fn(() => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
  })),
}));

jest.mock("../middleware/rateLimit", () => {
  const noop = (_req: any, _res: any, next: any) => next();
  return { globalLimiter: noop, authLimiter: noop, writeLimiter: noop, readLimiter: noop };
});

const _MOCK_ADDR = "GASPH4OCYOERATXIKLPNURXUP7ISAQU2KWFB5XLUJ3LQHKHOCN3CEGD6";

jest.mock("../utils/connectionPool", () => ({
  pool: {
    run: jest.fn().mockImplementation((fn: any) =>
      fn({
        getAccount: jest.fn().mockResolvedValue({ id: _MOCK_ADDR, sequence: "1" }),
        prepareTransaction: jest.fn().mockResolvedValue({ toXDR: () => "prepared_xdr" }),
        simulateTransaction: jest.fn().mockResolvedValue({ result: { retval: { value: 13_333 } } }),
        getHealth: jest.fn().mockResolvedValue({ status: "healthy" }),
      })
    ),
    stats: jest.fn().mockReturnValue({ size: 2, available: 2, inUse: 0, min: 2, max: 10 }),
  },
  PoolExhaustedError: class PoolExhaustedError extends Error {},
}));

jest.mock("../utils/rpcClient", () => ({
  __esModule: true,
  default: {
    getAccount: jest.fn().mockResolvedValue({ id: _MOCK_ADDR, sequence: "1" }),
    prepareTransaction: jest.fn().mockResolvedValue({ toXDR: () => "prepared_xdr" }),
    simulateTransaction: jest.fn().mockResolvedValue({ result: { retval: { value: 13_333 } } }),
    getHealth: jest.fn().mockResolvedValue({ status: "healthy" }),
  },
}));

jest.mock("@stellar/stellar-sdk", () => ({
  StrKey: {
    isValidEd25519PublicKey: (key: string) =>
      typeof key === "string" && key.length === 56 && key.startsWith("G"),
  },
  Networks: {
    TESTNET: "Test SDF Network ; September 2015",
    PUBLIC: "Public Global Stellar Network ; September 2015",
  },
  BASE_FEE: "100",
  Contract: jest.fn().mockImplementation(() => ({
    call: jest.fn().mockReturnValue({ type: "invokeHostFunction" }),
  })),
  TransactionBuilder: jest.fn().mockImplementation(() => ({
    addOperation: jest.fn().mockReturnThis(),
    setTimeout: jest.fn().mockReturnThis(),
    build: jest.fn().mockReturnValue({ toXDR: () => "mock_xdr_base64" }),
  })),
  Address: jest.fn().mockImplementation(() => ({
    toScVal: jest.fn().mockReturnValue({}),
  })),
  nativeToScVal: jest.fn().mockReturnValue({}),
  xdr: {
    ScVal: {
      scvVec: jest.fn((arr: any) => ({ type: "vec", value: arr })),
      scvVoid: jest.fn(() => ({ type: "void" })),
    },
  },
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { v1Router } from "./v1";
import { insertCollateral, insertLoan } from "../db/store";

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_ADDRESS = "GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR";

function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/v1", v1Router);
  return app;
}

function seedCollateral(id: string) {
  return insertCollateral({
    id,
    owner: VALID_ADDRESS,
    animal_type: "cattle",
    count: 3,
    appraised_value: 900_000,
  });
}

/**
 * Seed a loan with an explicit createdAt so we control the sort order.
 * We insert directly into the store after creation to set the timestamp.
 */
function seedLoanAt(id: string, collateralId: string, createdAt: string) {
  const loan = insertLoan({
    id,
    borrower: VALID_ADDRESS,
    collateral_id: collateralId,
    amount: 300_000,
  });
  // Patch timestamp directly (store uses plain Map, so mutation is safe in tests)
  Object.assign(loan, { createdAt });
  return loan;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/v1/loans — cursor-based pagination (#1219)", () => {
  let app: Express;

  beforeEach(() => {
    app = createApp();

    // Seed 5 collateral records
    for (let i = 1; i <= 5; i++) {
      seedCollateral(`cur-col-${i}`);
    }

    // Seed 5 loans with descending timestamps so sort order is deterministic
    const base = new Date("2026-09-01T00:00:00.000Z").getTime();
    for (let i = 1; i <= 5; i++) {
      const ts = new Date(base + (5 - i) * 1_000).toISOString(); // loan-1 newest
      seedLoanAt(`cur-loan-${i}`, `cur-col-${i}`, ts);
    }
  });

  // ── Basic cursor response shape ─────────────────────────────────────────────

  it("returns cursor mode fields when cursor param is absent (first page, no cursor)", async () => {
    const res = await request(app).get("/api/v1/loans?limit=2");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("paginationMode", "offset");
    expect(res.body).toHaveProperty("total");
    expect(res.body).toHaveProperty("page");
    expect(res.body).toHaveProperty("data");
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("returns cursor mode response shape when cursor= param is provided", async () => {
    const res = await request(app).get("/api/v1/loans?cursor=&limit=2");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("paginationMode", "cursor");
    expect(res.body).toHaveProperty("nextCursor");
    expect(res.body).toHaveProperty("hasMore");
    expect(res.body).toHaveProperty("data");
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  // ── First page ──────────────────────────────────────────────────────────────

  it("first page (empty cursor) returns up to limit records and nextCursor when more exist", async () => {
    const res = await request(app).get("/api/v1/loans?cursor=&limit=2");

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(2);
    expect(res.body.hasMore).toBe(true);
    expect(typeof res.body.nextCursor).toBe("string");
    expect(res.body.nextCursor.length).toBeGreaterThan(0);
  });

  // ── Multi-page traversal ────────────────────────────────────────────────────

  it("traverses all records across multiple pages without duplicates", async () => {
    const seenIds: string[] = [];
    let cursor = "";
    let iterations = 0;
    const maxIterations = 10;

    while (iterations < maxIterations) {
      const res = await request(app).get(
        `/api/v1/loans?cursor=${encodeURIComponent(cursor)}&limit=2`
      );
      expect(res.status).toBe(200);

      const ids: string[] = res.body.data.map((l: any) => l.id);
      seenIds.push(...ids);

      if (!res.body.hasMore || !res.body.nextCursor) break;
      cursor = res.body.nextCursor;
      iterations++;
    }

    // All seeded loans should appear exactly once
    const cursorLoanIds = seenIds.filter((id) => id.startsWith("cur-loan-"));
    expect(cursorLoanIds.length).toBe(5);
    expect(new Set(cursorLoanIds).size).toBe(5); // no duplicates
  });

  // ── Last page ───────────────────────────────────────────────────────────────

  it("last page returns hasMore=false and nextCursor=null", async () => {
    // Get first page to obtain the nextCursor
    const page1 = await request(app).get("/api/v1/loans?cursor=&limit=100");
    expect(page1.status).toBe(200);

    // A single page with limit ≥ total records means we're on the last page
    expect(page1.body.hasMore).toBe(false);
    expect(page1.body.nextCursor).toBeNull();
  });

  // ── Limit enforcement ───────────────────────────────────────────────────────

  it("respects limit param (max 100) in cursor mode", async () => {
    const res = await request(app).get("/api/v1/loans?cursor=&limit=1");

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(1);
    expect(res.body.limit).toBe(1);
  });

  it("defaults limit to 20 in cursor mode", async () => {
    const res = await request(app).get("/api/v1/loans?cursor=");

    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(20);
  });

  it("returns 400 for limit > 100 in cursor mode", async () => {
    const res = await request(app).get("/api/v1/loans?cursor=&limit=101");
    expect(res.status).toBe(400);
  });

  // ── Invalid cursor ──────────────────────────────────────────────────────────

  it("treats an invalid/garbage cursor as an empty cursor (first page)", async () => {
    const res = await request(app).get("/api/v1/loans?cursor=!!!notbase64!!!&limit=5");

    // Graceful degradation: treat as first page, no error
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("paginationMode", "cursor");
    expect(res.body).toHaveProperty("data");
  });

  // ── Backward compatibility — offset mode ────────────────────────────────────

  it("offset mode still works: returns total and page fields", async () => {
    const res = await request(app).get("/api/v1/loans?page=1&limit=20");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("paginationMode", "offset");
    expect(res.body).toHaveProperty("total");
    expect(res.body).toHaveProperty("page", 1);
    expect(res.body.nextCursor).toBeNull();
    expect(res.body.hasMore).toBe(false);
  });

  it("offset mode: returns 400 for invalid page=0", async () => {
    const res = await request(app).get("/api/v1/loans?page=0");
    expect(res.status).toBe(400);
  });

  // ── Filter + cursor ─────────────────────────────────────────────────────────

  it("cursor mode respects status filter", async () => {
    const res = await request(app).get("/api/v1/loans?cursor=&status=active&limit=10");

    expect(res.status).toBe(200);
    const statuses = res.body.data.map((l: any) => l.status);
    statuses.forEach((s: string) => expect(s).toBe("active"));
  });

  it("cursor mode returns 400 for invalid status value", async () => {
    const res = await request(app).get("/api/v1/loans?cursor=&status=unknown");
    expect(res.status).toBe(400);
  });

  // ── api_version header ──────────────────────────────────────────────────────

  it("response includes api_version: v1", async () => {
    const res = await request(app).get("/api/v1/loans?cursor=&limit=5");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("api_version", "v1");
  });
});
