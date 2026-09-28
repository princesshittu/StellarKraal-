/**
 * AppraisalHistoryChart.test.tsx — Issue #1209
 *
 * Tests for the collateral appraisal history Recharts line chart.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Recharts uses ResizeObserver which is not available in jsdom
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock Recharts to avoid SVG rendering complexity in tests
jest.mock("recharts", () => {
  const MockResponsiveContainer = ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  );
  const MockLineChart = ({ children, data }: { children: React.ReactNode; data: unknown[] }) => (
    <div data-testid="line-chart" data-points={data?.length}>{children}</div>
  );
  const MockLine = () => <div data-testid="chart-line" />;
  const MockXAxis = () => null;
  const MockYAxis = () => null;
  const MockCartesianGrid = () => null;
  const MockTooltip = () => null;
  const MockLegend = () => null;
  return {
    ResponsiveContainer: MockResponsiveContainer,
    LineChart: MockLineChart,
    Line: MockLine,
    XAxis: MockXAxis,
    YAxis: MockYAxis,
    CartesianGrid: MockCartesianGrid,
    Tooltip: MockTooltip,
    Legend: MockLegend,
  };
});

const COLLATERAL_ID = "col-abc-123";
const API = "http://localhost:3001";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockAppraisalFetch(data: unknown, status = 200) {
  global.fetch = jest.fn().mockResolvedValueOnce({
    ok: status === 200,
    status,
    json: async () => data,
  } as Response);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AppraisalHistoryChart — Issue #1209", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_API_URL = API;
  });

  it("shows a loading skeleton while data is fetching", () => {
    // Never resolve
    global.fetch = jest.fn().mockReturnValue(new Promise(() => {}));
    const { default: AppraisalHistoryChart } = require("@/components/AppraisalHistoryChart");
    render(<AppraisalHistoryChart collateralId={COLLATERAL_ID} />);
    expect(
      screen.getByRole("region", { name: /loading appraisal history chart/i })
    ).toBeInTheDocument();
  });

  it("shows empty state when fewer than 2 data points are returned", async () => {
    mockAppraisalFetch([{ date: "2025-01-01", value: 500 }]);
    const { default: AppraisalHistoryChart } = require("@/components/AppraisalHistoryChart");
    render(<AppraisalHistoryChart collateralId={COLLATERAL_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId("appraisal-chart-empty")).toBeInTheDocument();
    });
    expect(screen.getByText(/not enough appraisal data/i)).toBeInTheDocument();
  });

  it("shows empty state when no data points are returned", async () => {
    mockAppraisalFetch([]);
    const { default: AppraisalHistoryChart } = require("@/components/AppraisalHistoryChart");
    render(<AppraisalHistoryChart collateralId={COLLATERAL_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId("appraisal-chart-empty")).toBeInTheDocument();
    });
  });

  it("renders the chart when 2 or more data points exist", async () => {
    mockAppraisalFetch([
      { date: "2025-01-01", value: 450 },
      { date: "2025-02-01", value: 500 },
      { date: "2025-03-01", value: 475 },
    ]);
    const { default: AppraisalHistoryChart } = require("@/components/AppraisalHistoryChart");
    render(<AppraisalHistoryChart collateralId={COLLATERAL_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId("appraisal-history-chart")).toBeInTheDocument();
    });
    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
    expect(screen.getByTestId("chart-line")).toBeInTheDocument();
  });

  it("supports { data: [...] } envelope response format", async () => {
    mockAppraisalFetch({
      data: [
        { date: "2025-01-01", value: 450 },
        { date: "2025-02-01", value: 500 },
      ],
    });
    const { default: AppraisalHistoryChart } = require("@/components/AppraisalHistoryChart");
    render(<AppraisalHistoryChart collateralId={COLLATERAL_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId("appraisal-history-chart")).toBeInTheDocument();
    });
  });

  it("shows an error state when the API returns a non-200 status", async () => {
    mockAppraisalFetch({}, 500);
    const { default: AppraisalHistoryChart } = require("@/components/AppraisalHistoryChart");
    render(<AppraisalHistoryChart collateralId={COLLATERAL_ID} />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByText(/http 500/i)).toBeInTheDocument();
  });

  it("shows an error state when fetch rejects", async () => {
    global.fetch = jest.fn().mockRejectedValueOnce(new Error("Network error"));
    const { default: AppraisalHistoryChart } = require("@/components/AppraisalHistoryChart");
    render(<AppraisalHistoryChart collateralId={COLLATERAL_ID} />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByText(/network error/i)).toBeInTheDocument();
  });

  it("fetches from the correct API endpoint", async () => {
    mockAppraisalFetch([
      { date: "2025-01-01", value: 450 },
      { date: "2025-02-01", value: 500 },
    ]);
    const { default: AppraisalHistoryChart } = require("@/components/AppraisalHistoryChart");
    render(<AppraisalHistoryChart collateralId={COLLATERAL_ID} />);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        `${API}/api/v1/collateral/${COLLATERAL_ID}/appraisals`
      );
    });
  });
});
