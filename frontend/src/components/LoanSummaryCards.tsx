'use client';

import AnimatedCounter from '@/components/AnimatedCounter';
import Card from '@/components/Card';
import SkeletonStatCard from '@/components/SkeletonStatCard';
import { formatXlm } from '@/lib/formatMoney';

interface LoanSummary {
  /** Total loan principal in base units. */
  totalPrincipal: number;
  /** Outstanding balance in base units. */
  outstanding: number;
  /** Total interest accrued in base units. */
  interestAccrued: number;
  /** Number of active loans. */
  activeLoanCount: number;
}

interface LoanSummaryCardsProps {
  summary: LoanSummary;
  /**
   * When true, render skeleton placeholders instead of real values.
   * Use while the loan data is being fetched to prevent CLS and empty flicker.
   * Closes #1205.
   */
  loading?: boolean;
}

function formatAmount(n: number): string {
  return formatXlm(n / 1_000_000); // assume base units are micro-XLM
}

const METRICS: {
  key: keyof LoanSummary;
  label: string;
  formatter?: (n: number) => string;
  ariaLabel: string;
}[] = [
  {
    key: 'totalPrincipal',
    label: 'Total Principal',
    formatter: formatAmount,
    ariaLabel: 'Total principal in XLM',
  },
  {
    key: 'outstanding',
    label: 'Outstanding Balance',
    formatter: formatAmount,
    ariaLabel: 'Outstanding balance in XLM',
  },
  {
    key: 'interestAccrued',
    label: 'Interest Accrued',
    formatter: formatAmount,
    ariaLabel: 'Total interest accrued in XLM',
  },
  {
    key: 'activeLoanCount',
    label: 'Active Loans',
    formatter: (n) => n.toLocaleString(),
    ariaLabel: 'Number of active loans',
  },
];

/**
 * LoanSummaryCards renders a row of metric cards for loan portfolio data.
 *
 * Each numeric value animates from 0 to its target on mount, and re-animates
 * when the underlying data changes. The animation is disabled when the user
 * has `prefers-reduced-motion` set.
 *
 * When `loading` is true, skeleton placeholders replace all four cards so the
 * layout remains stable while data is in-flight (no CLS). Skeletons disappear
 * as soon as data or an error state is available. Closes #1205.
 */
export default function LoanSummaryCards({ summary, loading = false }: LoanSummaryCardsProps) {
  return (
    <section
      aria-label="Loan summary"
      data-print-section="loan-summary"
      className="loan-summary-print"
      /**
       * aria-busy signals to assistive technology that the region is still
       * loading. Screen readers will re-read the section once aria-busy
       * transitions from true → false.
       */
      aria-busy={loading}
    >
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {loading
          ? METRICS.map(({ key }) => (
              <SkeletonStatCard key={key} />
            ))
          : METRICS.map(({ key, label, formatter, ariaLabel }) => (
              <Card key={key}>
                <p className="text-xs font-medium uppercase tracking-wide text-brown/60 dark:text-brown-300/70 mb-1">
                  {label}
                </p>
                <AnimatedCounter
                  value={summary[key]}
                  formatter={formatter}
                  duration={1000}
                  aria-label={ariaLabel}
                  className="text-2xl font-bold text-brown dark:text-cream-50"
                />
              </Card>
            ))}
      </div>
    </section>
  );
}
