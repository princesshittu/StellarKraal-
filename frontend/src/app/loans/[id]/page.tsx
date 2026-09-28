'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import ErrorState from '@/components/ErrorState';
import DetailSkeleton from '@/components/DetailSkeleton';
import HealthGauge, { SkeletonHealthGauge } from '@/components/HealthGauge';
import HealthFactorAlert from '@/components/HealthFactorAlert';
import { useHealthFactor } from '@/hooks/useHealthFactor';

// Heavy component — loaded lazily to reduce initial JS bundle (#1070)
const LoanRepaymentCalculator = dynamic(() => import('@/components/LoanRepaymentCalculator'), {
  ssr: false,
  loading: () => <DetailSkeleton />,
});

interface LoanRecord {
  id: string;
  borrower: string;
  collateral_id: string;
  amount: number;
  outstanding?: number;
  collateral_value?: number;
  health_factor?: number;
  status: string;
  createdAt: string;
}

type ErrorType = '404' | 'network' | null;

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

type StickyLoanActionType = 'repay' | 'liquidate';

interface StickyLoanActionProps {
  targetRef: RefObject<HTMLElement | null>;
  action: StickyLoanActionType;
  onAction: () => void;
  disabled?: boolean;
}

const STICKY_ACTION_CONFIG = {
  repay: {
    label: 'Repay loan',
    buttonClass:
      'bg-[color:var(--token-primary)] text-[color:var(--token-on-primary)] hover:bg-[color:var(--token-primary-hover)]',
  },
  liquidate: {
    label: 'Liquidate loan',
    buttonClass:
      'bg-[color:var(--token-danger)] text-white hover:bg-[color:var(--token-danger)]/90',
  },
} as const;

function StickyActionIcon({ action }: { action: StickyLoanActionType }) {
  if (action === 'liquidate') {
    return (
      <svg
        aria-hidden="true"
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v3.75m0 3.75h.008M10.29 3.86L2.82 17a2 2 0 001.73 3h14.9a2 2 0 001.73-3L13.71 3.86a2 2 0 00-3.42 0z"
        />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-4-4l4 4 4-4M5 21h14" />
    </svg>
  );
}

export function StickyLoanAction({
  targetRef,
  action,
  onAction,
  disabled = false,
}: StickyLoanActionProps) {
  const [isMounted, setIsMounted] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const config = STICKY_ACTION_CONFIG[action];

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;

    let showTimer: ReturnType<typeof setTimeout> | undefined;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (showTimer) clearTimeout(showTimer);
        if (hideTimer) clearTimeout(hideTimer);

        const hasScrolledPast = !entry.isIntersecting && entry.boundingClientRect.bottom < 0;

        if (hasScrolledPast) {
          setIsMounted(true);
          showTimer = setTimeout(() => setIsVisible(true), 0);
        } else {
          setIsVisible(false);
          hideTimer = setTimeout(() => setIsMounted(false), 150);
        }
      },
      { threshold: 0 }
    );

    observer.observe(target);

    return () => {
      observer.disconnect();
      if (showTimer) clearTimeout(showTimer);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, [targetRef]);

  if (!isMounted) return null;

  return (
    <div
      role="region"
      aria-label="Quick loan action"
      aria-live="polite"
      aria-atomic="true"
      aria-hidden={!isVisible}
      inert={!isVisible}
      data-visible={isVisible}
      className={`fixed inset-x-0 bottom-16 z-50 border-t px-4 pb-2 pt-1 shadow-lg transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none sm:hidden ${
        isVisible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0'
      } border-[color:var(--token-border)] bg-[color:var(--token-surface-raised)]`}
    >
      <button
        type="button"
        onClick={onAction}
        disabled={disabled}
        className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-5 py-3 font-semibold shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--token-accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${config.buttonClass}`}
      >
        <StickyActionIcon action={action} />
        {config.label}
      </button>
    </div>
  );
}

export default function LoanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [loan, setLoan] = useState<LoanRecord | null>(null);
  const [error, setError] = useState<ErrorType>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [primaryActionReady, setPrimaryActionReady] = useState(false);
  const primaryActionRef = useRef<HTMLButtonElement>(null);

  // Real-time health factor — polls every 30 s, pauses when tab is hidden.
  // loanId is passed as empty string until id is confirmed; hook no-ops on ''.
  const {
    healthFactor,
    loading: hfLoading,
    lastUpdatedLabel,
    hasFetched: hfHasFetched,
  } = useHealthFactor(id ?? '');

  const fetchLoan = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${API}/api/loans/${id}`);
      if (res.status === 404) {
        setError('404');
        setLoan(null);
      } else if (!res.ok) {
        setError('network');
        setLoan(null);
      } else {
        const data = await res.json();
        setLoan(data.loan ?? data);
        setError(null);
      }
    } catch {
      setError('network');
      setLoan(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLoan();
  }, [id]);

  if (loading) {
    return <DetailSkeleton />;
  }

  if (error === '404') {
    return (
      <main className="max-w-2xl mx-auto px-4 py-10">
        <Link href="/loans" className="text-brown/60 hover:text-brown text-sm mb-6 inline-block">
          ← Back to Loans
        </Link>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20 p-6 text-center">
          <p className="text-5xl mb-4" aria-hidden="true">
            📄
          </p>
          <h1 className="text-2xl font-bold text-brown mb-2">Loan Not Found</h1>
          <p className="text-brown/60 mb-6">
            No loan record exists for ID <code className="bg-brown/10 px-1 rounded">{id}</code>.
          </p>
          <Link
            href="/loans"
            className="inline-block bg-brown text-cream px-5 py-2 rounded-xl font-semibold hover:bg-brown/80 transition focus:outline-none focus:ring-2 focus:ring-brown focus:ring-offset-2"
          >
            ← Back to Loans
          </Link>
        </div>
      </main>
    );
  }

  if (error === 'network') {
    return (
      <main className="max-w-2xl mx-auto px-4 py-10">
        <ErrorState message="Could not load loan – check your connection" onRetry={fetchLoan} />
      </main>
    );
  }

  if (!loan) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-10">
        <p className="text-brown/60">No data available</p>
      </main>
    );
  }

  async function copyId() {
    const loanId = loan?.id;
    if (!loanId) return;
    try {
      await navigator.clipboard.writeText(loanId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable
    }
  }

  return (
    <main
      className={`mx-auto max-w-2xl px-4 py-10 ${loan.status === 'active' ? 'pb-44 sm:pb-10' : ''}`}
    >
      <Link href="/loans" className="text-brown/60 hover:text-brown text-sm mb-6 inline-block">
        ← Back to Loans
      </Link>

      <div className="bg-white rounded-2xl p-6 shadow mb-6">
        <h1 className="text-2xl font-bold text-brown mb-4">Loan #{loan.id}</h1>
        <div className="flex items-center gap-2 mb-4">
          <span className="text-brown/50 text-sm">Loan ID</span>
          <button
            onClick={() => void copyId(loan.id)}
            aria-label={copied ? 'Loan ID copied' : 'Copy loan ID'}
            title={copied ? 'Copied!' : 'Copy ID'}
            className="shrink-0 text-brown/50 hover:text-brown transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brown rounded"
          >
            {copied ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4 text-green-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
                />
              </svg>
            )}
          </button>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-brown/50">Borrower</dt>
          <dd className="font-medium text-brown truncate" title={loan.borrower}>
            {loan.borrower.slice(0, 8)}…{loan.borrower.slice(-4)}
          </dd>
          <dt className="text-brown/50">Collateral ID</dt>
          <dd className="font-medium text-brown">{loan.collateral_id}</dd>
          <dt className="text-brown/50">Amount</dt>
          <dd className="font-medium text-brown">{(loan.amount / 1e7).toFixed(2)} XLM</dd>
          <dt className="text-brown/50">Status</dt>
          <dd className="font-medium text-brown capitalize">{loan.status}</dd>
          <dt className="text-brown/50">Created</dt>
          <dd className="font-medium text-brown">
            {new Date(loan.createdAt).toLocaleDateString()}
          </dd>
        </dl>
      </div>

      {loan.status === 'active' && (
        <>
          {/* Real-time health factor gauge + alert banners */}
          <section
            aria-label="Health factor"
            className="mb-6"
            data-testid="health-factor-section"
          >
            <div className="bg-white rounded-2xl p-6 shadow">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-brown">Health Factor</h2>
                {lastUpdatedLabel && (
                  <span
                    className="text-xs text-brown/40"
                    aria-label={`Health factor last updated ${lastUpdatedLabel}`}
                  >
                    Updated {lastUpdatedLabel}
                  </span>
                )}
                {hfLoading && (
                  <span className="text-xs text-brown/40 animate-pulse" aria-live="polite">
                    Refreshing…
                  </span>
                )}
              </div>

              {/* Gauge — show skeleton until first fetch completes */}
              {hfHasFetched && healthFactor !== null ? (
                <HealthGauge
                  value={Math.round(healthFactor * 10_000)}
                  aria-label={`Health factor: ${healthFactor.toFixed(2)}`}
                />
              ) : (
                <SkeletonHealthGauge />
              )}

              {/* Warning / critical alert banners */}
              {hfHasFetched && healthFactor !== null && (
                <div className="mt-4">
                  <HealthFactorAlert healthFactor={healthFactor} />
                </div>
              )}
            </div>
          </section>

          <LoanRepaymentCalculator
            loanId={loan.id}
            outstanding={loan.outstanding ?? loan.amount}
            collateralValue={loan.collateral_value ?? loan.amount}
            actionButtonRef={primaryActionRef}
            onPrimaryActionReady={setPrimaryActionReady}
            onProceed={() => router.push('/dashboard')}
          />
          {primaryActionReady && (
            <StickyLoanAction
              targetRef={primaryActionRef}
              action="repay"
              onAction={() => primaryActionRef.current?.click()}
            />
          )}
        </>
      )}
    </main>
  );
}
