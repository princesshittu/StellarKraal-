import {
  computeHealthFactor,
  simulateHealthFactor,
  runHealthFactorJob,
  _resetAlertCooldowns,
} from "./healthFactorJob";
import * as store from "../db/store";
import * as alerting from "../utils/alerting";
import { rpcClient } from "../utils/rpcClient";

// ── Mock stellar-sdk and rpcClient ───────────────────────────────────────────

jest.mock("@stellar/stellar-sdk", () => ({
  Networks: {
    TESTNET: "Test SDF Network ; September 2015",
    PUBLIC: "Public Global Stellar Network ; September 2015",
  },
  BASE_FEE: "100",
  Contract: jest.fn().mockImplementation(() => ({
    call: jest.fn().mockReturnValue({}),
  })),
  TransactionBuilder: jest.fn().mockImplementation(() => ({
    addOperation: jest.fn().mockReturnThis(),
    setTimeout: jest.fn().mockReturnThis(),
    build: jest.fn().mockReturnValue({ toXDR: () => "mock_xdr" }),
  })),
  nativeToScVal: jest.fn().mockReturnValue({}),
  scValToNative: jest.fn((val) => val),
}));

jest.mock("../utils/rpcClient", () => ({
  rpcClient: {
    getAccount: jest.fn().mockResolvedValue({ id: "GACCOUNT", sequence: "1" }),
    simulateTransaction: jest.fn(),
  },
}));

// ── simulateHealthFactor ──────────────────────────────────────────────────────

describe("simulateHealthFactor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("calls rpcClient.simulateTransaction and returns numeric health factor", async () => {
    (rpcClient.simulateTransaction as jest.Mock).mockResolvedValue({
      result: { retval: 12500 },
    });

    const hf = await simulateHealthFactor("101");
    expect(rpcClient.simulateTransaction).toHaveBeenCalled();
    expect(hf).toBe(12500);
  });

  it("returns null when simulation result has no retval", async () => {
    (rpcClient.simulateTransaction as jest.Mock).mockResolvedValue({
      result: {},
    });

    const hf = await simulateHealthFactor("102");
    expect(hf).toBeNull();
  });

  it("handles RPC errors gracefully and returns null", async () => {
    (rpcClient.simulateTransaction as jest.Mock).mockRejectedValue(
      new Error("RPC node unreachable")
    );

    const hf = await simulateHealthFactor("103");
    expect(hf).toBeNull();
  });
});

// ── computeHealthFactor ───────────────────────────────────────────────────────

describe("computeHealthFactor", () => {
  it("returns null when outstanding is zero", () => {
    expect(computeHealthFactor(1_000_000, 0)).toBeNull();
  });

  it("returns null when collateral value is zero", () => {
    expect(computeHealthFactor(0, 600_000)).toBeNull();
  });

  it("returns >= 10_000 for a safe loan (HF = 13_333)", () => {
    const hf = computeHealthFactor(1_000, 600);
    expect(hf).not.toBeNull();
    expect(hf!).toBeGreaterThanOrEqual(10_000);
  });

  it("returns < 10_000 for an at-risk loan (HF = 9_333)", () => {
    const hf = computeHealthFactor(700, 600);
    expect(hf).not.toBeNull();
    expect(hf!).toBeLessThan(10_000);
  });

  it("returns exactly 10_000 at the liquidation boundary", () => {
    const hf = computeHealthFactor(750, 600);
    expect(hf).toBe(10_000);
  });
});

// ── Threshold alert tests ─────────────────────────────────────────────────────

describe("runHealthFactorJob — threshold alerts", () => {
  let fireSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.restoreAllMocks();
    _resetAlertCooldowns();
    fireSpy = jest.spyOn(alerting, "fireAlert").mockResolvedValue(undefined);
  });

  function makeLoan(id: string, amount: number): store.LoanRecord {
    return {
      id,
      borrower: "G1",
      collateral_id: `col-${id}`,
      amount,
      status: "active",
      health_factor: null,
      createdAt: new Date().toISOString(),
      deletedAt: null,
    };
  }

  it("fires warning when on-chain HF is between CRIT (10000) and WARN (13000)", async () => {
    const loan = makeLoan("loan-w", 600);
    jest.spyOn(store, "listActiveLoans").mockReturnValue([loan]);
    (rpcClient.simulateTransaction as jest.Mock).mockResolvedValue({
      result: { retval: 12000 },
    });
    jest.spyOn(store, "updateLoan").mockReturnValue({ ...loan, health_factor: 12000, status: "active" });

    await runHealthFactorJob();

    expect(fireSpy).toHaveBeenCalledTimes(1);
    expect(fireSpy.mock.calls[0][0].severity).toBe("warning");
  });

  it("fires critical when on-chain HF is below CRIT (10000)", async () => {
    const loan = makeLoan("loan-c", 600);
    jest.spyOn(store, "listActiveLoans").mockReturnValue([loan]);
    (rpcClient.simulateTransaction as jest.Mock).mockResolvedValue({
      result: { retval: 9333 },
    });
    jest.spyOn(store, "updateLoan").mockReturnValue({ ...loan, health_factor: 9333, status: "at_risk" });

    await runHealthFactorJob();

    expect(fireSpy).toHaveBeenCalledTimes(1);
    expect(fireSpy.mock.calls[0][0].severity).toBe("critical");
  });

  it("does not fire alert when on-chain HF is above WARN (13000)", async () => {
    const loan = makeLoan("loan-safe", 600);
    jest.spyOn(store, "listActiveLoans").mockReturnValue([loan]);
    (rpcClient.simulateTransaction as jest.Mock).mockResolvedValue({
      result: { retval: 13333 },
    });
    jest.spyOn(store, "updateLoan").mockReturnValue({ ...loan, health_factor: 13333, status: "active" });

    await runHealthFactorJob();

    expect(fireSpy).not.toHaveBeenCalled();
  });

  it("cooldown suppresses a second alert within 1 hour for the same loan", async () => {
    const loan = makeLoan("loan-cd", 600);
    jest.spyOn(store, "listActiveLoans").mockReturnValue([loan]);
    (rpcClient.simulateTransaction as jest.Mock).mockResolvedValue({
      result: { retval: 9333 },
    });
    jest.spyOn(store, "updateLoan").mockReturnValue({ ...loan });

    await runHealthFactorJob();
    await runHealthFactorJob(); // second run within the same process — cooldown active

    expect(fireSpy).toHaveBeenCalledTimes(1);
  });
});

// ── runHealthFactorJob — job logic ────────────────────────────────────────────

describe("runHealthFactorJob", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    _resetAlertCooldowns();
    jest.spyOn(alerting, "fireAlert").mockResolvedValue(undefined);
  });

  it("flags at_risk loans below threshold and updates on-chain health_factor", async () => {
    const loans: store.LoanRecord[] = [
      {
        id: "loan-1",
        borrower: "G1",
        collateral_id: "col-1",
        amount: 600,
        status: "active",
        health_factor: null,
        createdAt: new Date().toISOString(),
        deletedAt: null,
      },
    ];

    jest.spyOn(store, "listActiveLoans").mockReturnValue(loans);
    (rpcClient.simulateTransaction as jest.Mock).mockResolvedValue({
      result: { retval: 9333 },
    });
    const updateSpy = jest.spyOn(store, "updateLoan").mockReturnValue({
      ...loans[0],
      status: "at_risk",
      health_factor: 9333,
    });

    const count = await runHealthFactorJob();

    expect(updateSpy).toHaveBeenCalledWith(
      "loan-1",
      expect.objectContaining({ status: "at_risk", health_factor: 9333 })
    );
    expect(count).toBe(1);
  });

  it("keeps active status for safe loans and updates on-chain health_factor", async () => {
    const loans: store.LoanRecord[] = [
      {
        id: "loan-2",
        borrower: "G2",
        collateral_id: "col-2",
        amount: 600,
        status: "active",
        health_factor: null,
        createdAt: new Date().toISOString(),
        deletedAt: null,
      },
    ];

    jest.spyOn(store, "listActiveLoans").mockReturnValue(loans);
    (rpcClient.simulateTransaction as jest.Mock).mockResolvedValue({
      result: { retval: 13333 },
    });
    const updateSpy = jest.spyOn(store, "updateLoan").mockReturnValue({
      ...loans[0],
      status: "active",
      health_factor: 13333,
    });

    const count = await runHealthFactorJob();

    expect(updateSpy).toHaveBeenCalledWith(
      "loan-2",
      expect.objectContaining({ status: "active", health_factor: 13333 })
    );
    expect(count).toBe(1);
  });

  it("skips update when health_factor and status are unchanged", async () => {
    const loans: store.LoanRecord[] = [
      {
        id: "loan-3",
        borrower: "G3",
        collateral_id: "col-3",
        amount: 600,
        status: "at_risk",
        health_factor: 9333,
        createdAt: new Date().toISOString(),
        deletedAt: null,
      },
    ];

    jest.spyOn(store, "listActiveLoans").mockReturnValue(loans);
    (rpcClient.simulateTransaction as jest.Mock).mockResolvedValue({
      result: { retval: 9333 },
    });
    const updateSpy = jest.spyOn(store, "updateLoan");

    const count = await runHealthFactorJob();

    expect(updateSpy).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });

  it("returns 0 when there are no active loans", async () => {
    jest.spyOn(store, "listActiveLoans").mockReturnValue([]);
    const count = await runHealthFactorJob();
    expect(count).toBe(0);
  });

  it("handles simulation failure gracefully by skipping the loan", async () => {
    const loans: store.LoanRecord[] = [
      {
        id: "loan-4",
        borrower: "G4",
        collateral_id: "col-4",
        amount: 600,
        status: "active",
        health_factor: null,
        createdAt: new Date().toISOString(),
        deletedAt: null,
      },
      {
        id: "loan-5",
        borrower: "G5",
        collateral_id: "col-5",
        amount: 800,
        status: "active",
        health_factor: null,
        createdAt: new Date().toISOString(),
        deletedAt: null,
      },
    ];

    jest.spyOn(store, "listActiveLoans").mockReturnValue(loans);
    // First loan fails RPC, second loan succeeds
    (rpcClient.simulateTransaction as jest.Mock)
      .mockRejectedValueOnce(new Error("RPC Timeout"))
      .mockResolvedValueOnce({ result: { retval: 11000 } });

    const updateSpy = jest.spyOn(store, "updateLoan").mockReturnValue({ ...loans[1] });

    const count = await runHealthFactorJob();

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith(
      "loan-5",
      expect.objectContaining({ health_factor: 11000, status: "active" })
    );
    expect(count).toBe(1);
  });
});
