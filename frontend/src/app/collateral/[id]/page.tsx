"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import Sparkline from "@/components/Sparkline";
import ErrorState from "@/components/ErrorState";
import DetailSkeleton from "@/components/DetailSkeleton";
import CollateralLocationSection from "@/components/CollateralLocationSection";
import LiquidationThresholdBadge from "@/components/LiquidationThresholdBadge";
import { formatXlmNumber } from "@/lib/formatMoney";

// Heavy components — loaded lazily to reduce initial JS bundle (#1070)
const PriceChart = dynamic(
  () => import("@/components/PriceChart").then((m) => ({ default: m.PriceChart })),
  {
    ssr: false,
    loading: () => <DetailSkeleton />,
  },
);
const TransactionHistory = dynamic(() => import("@/components/TransactionHistory"), {
  ssr: false,
  loading: () => <DetailSkeleton />,
});
// Issue #1209: Recharts-based appraisal history chart — lazy loaded
const AppraisalHistoryChart = dynamic(
  () => import("@/components/AppraisalHistoryChart"),
  {
    ssr: false,
    loading: () => <DetailSkeleton />,
  },
);

interface AppraisalEntry {
  date: string;
  value: number;
}

interface CollateralRecord {
  id: string;
  owner: string;
  animal_type: string;
  breed?: string;
  age_years?: number;
  weight_kg?: number;
  photo_url?: string;
  count: number;
  appraised_value: number;
  appraisal_history: AppraisalEntry[];
  createdAt: string;
  /** Optional GPS / text location — shown in location placeholder section (#568). */
  location?: string | null;
  /** Liquidation threshold in bps from the backend, e.g. 8000 = 80% (#697). */
  liquidation_threshold_bps?: number | null;
}

type ErrorType = '404' | 'network' | null;

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export default function CollateralDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [record, setRecord] = useState<CollateralRecord | null>(null);
  const [error, setError] = useState<ErrorType>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const fetchCollateral = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${API}/api/v1/collateral/${id}`);
      if (res.status === 404) {
        setError('404');
        setRecord(null);
      } else if (!res.ok) {
        setError('network');
        setRecord(null);
      } else {
        const data = await res.json();
        setRecord(data);
        setError(null);
      }
    } catch {
      setError('network');
      setRecord(null);
    } finally {
      setLoading(false);
    }
  };

  async function copyId() {
    if (!id) return;
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable
    }
  }

  useEffect(() => {
    fetchCollateral();
  }, [id]);

  if (loading) {
    return <DetailSkeleton />;
  }

  if (error === '404') {
    return (
      <main className="max-w-2xl mx-auto px-4 py-10">
        <Link
          href="/collateral"
          className="text-brown/60 hover:text-brown text-sm mb-6 inline-block"
        >
          ← Back to Collateral List
        </Link>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20 p-6 text-center">
          <p className="text-5xl mb-4" aria-hidden="true">
            🐄
          </p>
          <h1 className="text-2xl font-bold text-brown mb-2">Collateral Not Found</h1>
          <p className="text-brown/60 mb-6">
            No collateral record exists for ID{' '}
            <code className="bg-brown/10 px-1 rounded">{id}</code>.
          </p>
          <Link
            href="/collateral"
            className="inline-block bg-brown text-cream px-5 py-2 rounded-xl font-semibold hover:bg-brown/80 transition focus:outline-none focus:ring-2 focus:ring-brown focus:ring-offset-2"
          >
            ← Back to Collateral List
          </Link>
        </div>
      </main>
    );
  }

  if (error === 'network') {
    return (
      <main className="max-w-2xl mx-auto px-4 py-10">
        <ErrorState
          message="Could not load collateral – check your connection"
          onRetry={fetchCollateral}
        />
      </main>
    );
  }

  if (!record) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-10">
        <p className="text-brown/60">No data available</p>
      </main>
    );
  }

  const latestValue = record.appraised_value;

  return (
    <main className="max-w-2xl mx-auto px-4 py-10" data-print="content">
      <Link
        href="/dashboard"
        className="text-brown/60 hover:text-brown text-sm mb-6 inline-block no-print"
        data-print="hide"
      >
        ← Back to Dashboard
      </Link>

      {/* Animal profile */}
      <div
        className="bg-white rounded-2xl p-6 shadow mb-6 flex gap-6 items-start collateral-detail-card"
        data-print="show"
      >
        {record.photo_url ? (
          <div className="relative w-24 h-24 rounded-xl overflow-hidden flex-shrink-0">
            <Image
              src={record.photo_url}
              alt={`${record.animal_type} collateral photo`}
              fill
              sizes="(max-width: 640px) 96px, 96px"
              className="object-cover"
              loading="lazy"
              placeholder="blur"
              blurDataURL="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iOTYiIGhlaWdodD0iOTYiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0iI0YwRDlCOCIvPjwvc3ZnPg=="
            />
          </div>
        ) : (
          <div className="w-24 h-24 rounded-xl bg-cream flex items-center justify-center text-4xl flex-shrink-0">
            {record.animal_type.toLowerCase().includes('goat')
              ? '🐐'
              : record.animal_type.toLowerCase().includes('sheep')
                ? '🐑'
                : '🐄'}
          </div>
        )}
        <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-brown capitalize">{record.animal_type}</h1>
            <div className="flex items-center gap-2 mb-3">
              <p className="text-brown/50 text-sm">ID: {record.id}</p>
              <button
                onClick={copyId}
                aria-label={copied ? "Collateral ID copied" : "Copy collateral ID"}
                title={copied ? "Copied!" : "Copy ID"}
                className="shrink-0 text-brown/50 hover:text-brown transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brown rounded"
              >
                {copied ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                  </svg>
                )}
              </button>
            </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {record.breed && (
              <>
                <dt className="text-brown/50">Breed</dt>
                <dd className="font-medium text-brown">{record.breed}</dd>
              </>
            )}
            {record.age_years != null && (
              <>
                <dt className="text-brown/50">Age</dt>
                <dd className="font-medium text-brown">{record.age_years} yr</dd>
              </>
            )}
            {record.weight_kg != null && (
              <>
                <dt className="text-brown/50">Weight</dt>
                <dd className="font-medium text-brown">{record.weight_kg} kg</dd>
              </>
            )}
            <dt className="text-brown/50">Count</dt>
            <dd className="font-medium text-brown">{record.count}</dd>
            <dt className="text-brown/50">Owner</dt>
            <dd className="font-medium text-brown truncate" title={record.owner}>
              {record.owner.slice(0, 8)}…{record.owner.slice(-4)}
            </dd>
          </dl>
        </div>
      </div>

      {/* Current appraised value */}
      <div
        className="bg-gold/10 border border-gold/30 rounded-2xl p-6 shadow mb-6 text-center loan-summary-card"
        data-print="show"
      >
        <p className="text-sm text-brown/60 mb-1">Current Appraised Value</p>
        <p className="text-4xl font-bold text-brown">{(latestValue / 1e7).toFixed(2)} <span className="text-xl font-normal text-brown/60">XLM</span></p>
        {record.appraisal_history.length >= 2 && (
          <div className="mt-3 flex justify-center">
            <Sparkline data={record.appraisal_history.map((entry) => ({ date: entry.date, value: entry.value }))} />
          </div>
        )}
      </div>

      {/* Appraisal history */}
      <div className="bg-white rounded-2xl p-6 shadow loan-summary-card" data-print="show">
        <h2 className="text-lg font-semibold text-brown mb-4">Appraisal History</h2>
        {record.appraisal_history.length === 0 ? (
          <p className="text-brown/50 text-sm">No appraisal history yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-brown/50 border-b border-brown/10">
                <th className="pb-2 font-medium">Date</th>
                <th className="pb-2 font-medium text-right">Value (XLM)</th>
              </tr>
            </thead>
            <tbody>
              {[...record.appraisal_history].reverse().map((entry, i) => (
                <tr key={i} className="border-b border-brown/5 last:border-0">
                  <td className="py-2 text-brown/70">
                    {new Date(entry.date).toLocaleDateString()}
                  </td>
                  <td className="py-2 text-right font-medium text-brown dark:text-cream-50">
                    {formatXlmNumber(entry.value / 1e7)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Transactions tied to this collateral — #530 */}
      <div className="mt-6" data-print="hide">
        <TransactionHistory collateralId={record.id} />
      </div>

      {/* Price history chart — hidden when printing (canvas-based) */}
      <div className="mt-6 no-print" data-print="hide">
        <PriceChart
          url={`${API}/api/v1/collateral/${id}/appraisals`}
          label="Price History"
        />
      </div>

      {/* Appraisal history chart (Recharts) — Issue #1209 */}
      <div className="mt-6 no-print" data-print="hide">
        <AppraisalHistoryChart collateralId={record.id} />
      </div>

      {/* Liquidation threshold — #697 */}
      <LiquidationThresholdBadge thresholdBps={record.liquidation_threshold_bps} />

      {/* Location placeholder — #568 */}
      <CollateralLocationSection location={record.location} />
    </main>
  );
}
