/**
 * Integration tests for GET /api/v1/health/deep
 */
import request from "supertest";
import express, { Express } from "express";
import { healthRouter } from "./health";

// ── Mock dependencies ─────────────────────────────────────────────────────────

jest.mock("../db/migrationRunner", () => ({
  checkDbHealth: jest.fn(),
}));

jest.mock("../utils/rpcClient", () => ({
  __esModule: true,
  default: {
    getHealth: jest.fn(),
  },
}));

jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { checkDbHealth } from "../db/migrationRunner";
import rpcClient from "../utils/rpcClient";

const mockCheckDbHealth = checkDbHealth as jest.MockedFunction<typeof checkDbHealth>;
const mockRpcGetHealth = rpcClient.getHealth as jest.MockedFunction<typeof rpcClient.getHealth>;

// ── Test setup ────────────────────────────────────────────────────────────────

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/health", healthRouter);
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/v1/health/live", () => {
  let app: Express;

  beforeEach(() => {
    app = buildApp();
  });

  it("returns 200", async () => {
    const res = await request(app).get("/api/v1/health/live");
    expect(res.status).toBe(200);
  });

  it("returns { status: 'alive' }", async () => {
    const res = await request(app).get("/api/v1/health/live");
    expect(res.body.status).toBe("alive");
  });

  it("responds with JSON content-type", async () => {
    const res = await request(app).get("/api/v1/health/live");
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });
});

describe("GET /api/v1/health/ready", () => {
  let app: Express;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  describe("all dependencies reachable", () => {
    beforeEach(() => {
      mockCheckDbHealth.mockResolvedValue(true);
      mockRpcGetHealth.mockResolvedValue({ status: "healthy" } as any);
    });

    it("returns 200", async () => {
      const res = await request(app).get("/api/v1/health/ready");
      expect(res.status).toBe(200);
    });

    it("returns { status: 'ready', db: 'ok', rpc: 'ok' }", async () => {
      const res = await request(app).get("/api/v1/health/ready");
      expect(res.body).toMatchObject({ status: "ready", db: "ok", rpc: "ok" });
    });
  });

  describe("db unreachable", () => {
    beforeEach(() => {
      mockCheckDbHealth.mockResolvedValue(false);
      mockRpcGetHealth.mockResolvedValue({ status: "healthy" } as any);
    });

    it("returns 503", async () => {
      const res = await request(app).get("/api/v1/health/ready");
      expect(res.status).toBe(503);
    });

    it("returns { status: 'not_ready', db: 'degraded' }", async () => {
      const res = await request(app).get("/api/v1/health/ready");
      expect(res.body.status).toBe("not_ready");
      expect(res.body.db).toBe("degraded");
    });
  });

  describe("rpc unreachable", () => {
    beforeEach(() => {
      mockCheckDbHealth.mockResolvedValue(true);
      mockRpcGetHealth.mockRejectedValue(new Error("connection refused"));
    });

    it("returns 503", async () => {
      const res = await request(app).get("/api/v1/health/ready");
      expect(res.status).toBe(503);
    });

    it("returns { status: 'not_ready', rpc: 'degraded' }", async () => {
      const res = await request(app).get("/api/v1/health/ready");
      expect(res.body.status).toBe("not_ready");
      expect(res.body.rpc).toBe("degraded");
    });
  });
});

describe("GET /api/v1/health/deep", () => {
  let app: Express;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  describe("all components healthy", () => {
    beforeEach(() => {
      mockCheckDbHealth.mockResolvedValue(true);
      mockRpcGetHealth.mockResolvedValue({ status: "healthy" } as any);
      // disk check will use real fs — in CI the working dir always has > 500 MB free
    });

    it("returns 200", async () => {
      const res = await request(app).get("/api/v1/health/deep");
      expect(res.status).toBe(200);
    });

    it("returns { db: 'ok', rpc: 'ok' } at minimum", async () => {
      const res = await request(app).get("/api/v1/health/deep");
      expect(res.body.db).toBe("ok");
      expect(res.body.rpc).toBe("ok");
    });

    it("response only contains db, rpc, and disk keys", async () => {
      const res = await request(app).get("/api/v1/health/deep");
      expect(Object.keys(res.body).sort()).toEqual(["db", "disk", "rpc"]);
    });
  });

  describe("db degraded", () => {
    beforeEach(() => {
      mockCheckDbHealth.mockResolvedValue(false);
      mockRpcGetHealth.mockResolvedValue({ status: "healthy" } as any);
    });

    it("returns 503", async () => {
      const res = await request(app).get("/api/v1/health/deep");
      expect(res.status).toBe(503);
    });

    it("returns { db: 'degraded' }", async () => {
      const res = await request(app).get("/api/v1/health/deep");
      expect(res.body.db).toBe("degraded");
    });

    it("still reports rpc status correctly", async () => {
      const res = await request(app).get("/api/v1/health/deep");
      expect(res.body.rpc).toBe("ok");
    });
  });

  describe("rpc degraded", () => {
    beforeEach(() => {
      mockCheckDbHealth.mockResolvedValue(true);
      mockRpcGetHealth.mockRejectedValue(new Error("connection refused"));
    });

    it("returns 503", async () => {
      const res = await request(app).get("/api/v1/health/deep");
      expect(res.status).toBe(503);
    });

    it("returns { rpc: 'degraded' }", async () => {
      const res = await request(app).get("/api/v1/health/deep");
      expect(res.body.rpc).toBe("degraded");
    });

    it("still reports db status correctly", async () => {
      const res = await request(app).get("/api/v1/health/deep");
      expect(res.body.db).toBe("ok");
    });
  });

  describe("disk degraded", () => {
    beforeEach(() => {
      mockCheckDbHealth.mockResolvedValue(true);
      mockRpcGetHealth.mockResolvedValue({ status: "healthy" } as any);
    });

    it("returns 503 when disk check fails", async () => {
      // Override checkDiskHealth by mocking fs.statfs to simulate low disk
      const origStatfs = (require("fs") as any).statfs;
      (require("fs") as any).statfs = (
        _path: string,
        cb: (err: null, stats: { bfree: number; bsize: number }) => void
      ) => cb(null, { bfree: 1, bsize: 1024 }); // 1 KB free — well below threshold

      const res = await request(app).get("/api/v1/health/deep");
      expect(res.status).toBe(503);
      expect(res.body.disk).toBe("degraded");

      // Restore
      if (origStatfs) (require("fs") as any).statfs = origStatfs;
    });
  });

  describe("all components degraded", () => {
    beforeEach(() => {
      mockCheckDbHealth.mockResolvedValue(false);
      mockRpcGetHealth.mockRejectedValue(new Error("rpc down"));
    });

    it("returns 503", async () => {
      const res = await request(app).get("/api/v1/health/deep");
      expect(res.status).toBe(503);
    });

    it("returns all statuses as degraded (except possibly disk)", async () => {
      const res = await request(app).get("/api/v1/health/deep");
      expect(res.body.db).toBe("degraded");
      expect(res.body.rpc).toBe("degraded");
    });
  });

  describe("error envelope", () => {
    it("responds with JSON content-type", async () => {
      mockCheckDbHealth.mockResolvedValue(true);
      mockRpcGetHealth.mockResolvedValue({ status: "healthy" } as any);

      const res = await request(app).get("/api/v1/health/deep");
      expect(res.headers["content-type"]).toMatch(/application\/json/);
    });
  });
});

// ── GET /api/v1/health (root) — issue #1536 ───────────────────────────────────

describe("GET /api/v1/health (root) — structured fields", () => {
  let app: Express;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  describe("all dependencies healthy", () => {
    beforeEach(() => {
      mockCheckDbHealth.mockResolvedValue(true);
      mockRpcGetHealth.mockResolvedValue({ status: "healthy" } as any);
    });

    it("returns 200", async () => {
      const res = await request(app).get("/api/v1/health");
      expect(res.status).toBe(200);
    });

    it("includes status: 'healthy'", async () => {
      const res = await request(app).get("/api/v1/health");
      expect(res.body.status).toBe("healthy");
    });

    it("includes an ISO-8601 timestamp", async () => {
      const res = await request(app).get("/api/v1/health");
      expect(typeof res.body.timestamp).toBe("string");
      expect(() => new Date(res.body.timestamp).toISOString()).not.toThrow();
    });

    it("includes a non-negative uptime (seconds)", async () => {
      const res = await request(app).get("/api/v1/health");
      expect(typeof res.body.uptime).toBe("number");
      expect(res.body.uptime).toBeGreaterThanOrEqual(0);
    });

    it("includes a version string", async () => {
      const res = await request(app).get("/api/v1/health");
      expect(typeof res.body.version).toBe("string");
      expect(res.body.version.length).toBeGreaterThan(0);
    });

    it("includes components for db, rpc, and eventListener", async () => {
      const res = await request(app).get("/api/v1/health");
      expect(res.body.components).toBeDefined();
      expect(res.body.components.db).toBe("ok");
      expect(res.body.components.rpc).toBe("ok");
      expect(typeof res.body.components.eventListener).toBe("string");
    });
  });

  describe("critical dependency unreachable — returns 503", () => {
    it("returns 503 when db is degraded", async () => {
      mockCheckDbHealth.mockResolvedValue(false);
      mockRpcGetHealth.mockResolvedValue({ status: "healthy" } as any);

      const res = await request(app).get("/api/v1/health");
      expect(res.status).toBe(503);
      expect(res.body.components.db).toBe("degraded");
    });

    it("returns 503 when rpc is degraded", async () => {
      mockCheckDbHealth.mockResolvedValue(true);
      mockRpcGetHealth.mockRejectedValue(new Error("connection refused"));

      const res = await request(app).get("/api/v1/health");
      expect(res.status).toBe(503);
      expect(res.body.components.rpc).toBe("degraded");
    });

    it("still includes timestamp, uptime, and version on 503", async () => {
      mockCheckDbHealth.mockResolvedValue(false);
      mockRpcGetHealth.mockRejectedValue(new Error("down"));

      const res = await request(app).get("/api/v1/health");
      expect(typeof res.body.timestamp).toBe("string");
      expect(typeof res.body.uptime).toBe("number");
      expect(typeof res.body.version).toBe("string");
    });
  });

  describe("response timing", () => {
    it("responds within 2500 ms even when all checks pass", async () => {
      mockCheckDbHealth.mockResolvedValue(true);
      mockRpcGetHealth.mockResolvedValue({ status: "healthy" } as any);

      const start = Date.now();
      await request(app).get("/api/v1/health");
      expect(Date.now() - start).toBeLessThan(2500);
    });
  });
});
