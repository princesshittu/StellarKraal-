"use client";
/**
 * AppraisalHistoryChart — Issue #1209
 *
 * Renders a responsive Recharts line chart showing historical appraisal values
 * for a collateral asset.
 *
 * - X-axis: date (formatted as MMM d)
 * - Y-axis: appraised value in USD
 * - Responsive: uses ResponsiveContainer so it works on mobile + desktop
 * - Empty state: shown when fewer than 2 data points exist
 * - Data source: GET /api/v1/collateral/:id/appraisals
 *
 * Acceptance criteria (Issue #1209):
 * ✓ Line chart rendered with Recharts
 * ✓ X-axis shows date, Y-axis shows appraised value in USD
 * ✓ Chart is responsive (mobile + desktop)
 * ✓ Empty state shown when fewer than 2 data points exist
 * ✓ Data fetched from GET /api/v1/collateral/:id/appraisals
 */
import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AppraisalPoint {
  /** ISO 8601 date string, e.g. "2025-03-15" */
  date: string;
  /** Appraised value in USD (floating point) */
  value: number;
}

interface ChartDataPoint {
  date: string;
  value: number;
  /** Formatted date label shown on X-axis */
  dateLabel: string;
}

interface Props {
  /** Collateral asset ID — used to fetch appraisal history */
  collateralId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

/** Format a date string to a short label like "Mar 15" */
function formatDateLabel(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

/** Format a USD value for the Y-axis tick */
function formatUsdTick(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

// ─── Custom tooltip ───────────────────────────────────────────────────────────

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const val = payload[0].value;
  return (
    <div
      className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface-raised,#fff)] px-3 py-2 shadow-md text-sm"
      role="tooltip"
    >
      <p className="font-semibold text-[color:var(--color-text)]">{label}</p>
      <p className="text-[color:var(--token-accent)]">
        ${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </p>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AppraisalHistoryChart({ collateralId }: Props) {
  const [data, setData] = useState<ChartDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!collateralId) return;
    setLoading(true);
    setError(null);

    fetch(`${API}/api/v1/collateral/${collateralId}/appraisals`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as unknown;
        // Support both { data: [...] } and direct array responses
        const raw: unknown[] = Array.isArray(json)
          ? json
          : Array.isArray((json as Record<string, unknown>).data)
          ? ((json as Record<string, unknown>).data as unknown[])
          : [];
        const points: ChartDataPoint[] = (raw as AppraisalPoint[]).map((p) => ({
          date: p.date,
          value: Number(p.value),
          dateLabel: formatDateLabel(p.date),
        }));
        setData(points);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load appraisal history");
      })
      .finally(() => setLoading(false));
  }, [collateralId]);

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <section
        className="bg-[color:var(--color-surface-raised,#fff)] rounded-2xl p-6 shadow"
        aria-label="Loading appraisal history chart"
        aria-busy="true"
      >
        <div className="h-6 w-48 skeleton-shimmer rounded mb-4" />
        <div className="h-56 skeleton-shimmer rounded" />
      </section>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (error) {
    return (
      <section
        className="bg-[color:var(--color-surface-raised,#fff)] rounded-2xl p-6 shadow"
        role="alert"
        aria-label="Appraisal history chart error"
      >
        <h2 className="text-lg font-semibold text-brown mb-2">Appraisal History</h2>
        <p className="text-sm text-red-500">{error}</p>
      </section>
    );
  }

  // ── Empty state (< 2 data points) ─────────────────────────────────────────
  if (data.length < 2) {
    return (
      <section
        className="bg-[color:var(--color-surface-raised,#fff)] rounded-2xl p-6 shadow"
        aria-label="Appraisal history chart — no data"
        data-testid="appraisal-chart-empty"
      >
        <h2 className="text-lg font-semibold text-brown mb-3">Appraisal History</h2>
        <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-10 w-10 text-brown/20"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"
            />
          </svg>
          <p className="text-sm text-brown/50">
            Not enough appraisal data to display a chart.
            <br />
            At least 2 appraisals are needed.
          </p>
        </div>
      </section>
    );
  }

  // ── Chart ──────────────────────────────────────────────────────────────────
  return (
    <section
      className="bg-[color:var(--color-surface-raised,#fff)] rounded-2xl p-6 shadow"
      aria-label="Collateral appraisal history chart"
      data-testid="appraisal-history-chart"
    >
      <h2 className="text-lg font-semibold text-brown mb-4">Appraisal History</h2>
      {/* ResponsiveContainer makes the chart adapt to any screen width */}
      <ResponsiveContainer width="100%" height={240}>
        <LineChart
          data={data}
          margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
          aria-label="Line chart of collateral appraisal values over time"
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--color-border, #e5e7eb)"
            vertical={false}
          />
          <XAxis
            dataKey="dateLabel"
            tick={{ fontSize: 11, fill: "var(--color-text-muted, #6b7280)" }}
            axisLine={false}
            tickLine={false}
            dy={8}
          />
          <YAxis
            tickFormatter={formatUsdTick}
            tick={{ fontSize: 11, fill: "var(--color-text-muted, #6b7280)" }}
            axisLine={false}
            tickLine={false}
            width={56}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
            formatter={() => "Appraised Value (USD)"}
          />
          <Line
            type="monotone"
            dataKey="value"
            name="Appraised Value (USD)"
            stroke="var(--token-accent, #d4a017)"
            strokeWidth={2}
            dot={{ r: 3, fill: "var(--token-accent, #d4a017)", strokeWidth: 0 }}
            activeDot={{ r: 5, fill: "var(--token-accent, #d4a017)" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </section>
  );
}
