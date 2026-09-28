'use client';
import { Suspense, useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Download } from 'lucide-react';
import SearchFilterBar from '@/components/SearchFilterBar';
import PageTransition from '@/components/PageTransition';
import Card from '@/components/Card';
import ScrollToTopButton from '@/components/ScrollToTopButton';
import Spinner from '@/components/Spinner';
import { badgeVariants } from '@/lib/animations';
import { useScrollPosition } from '@/hooks/useScrollPosition';
import { toCsvString, downloadCsv, csvFilename, type CsvColumn } from '@/lib/exportCsv';

interface Loan {
  id: string;
  borrower: string;
  amount: number;
  status: string;
  collateralId?: string;
  createdAt: string;
  updatedAt?: string;
}

const STATUS_OPTIONS = ['active', 'repaid', 'liquidated', 'pending'];
const TYPE_OPTIONS: string[] = [];
/** Max XLM slider bound — adjust if portfolio amounts grow beyond 100k */
const MAX_AMOUNT = 100_000;

/** CSV column definitions for loan export — closes #1203 */
const LOAN_CSV_COLUMNS: CsvColumn<Loan>[] = [
  { header: 'Loan ID', value: (loan) => loan.id },
  { header: 'Status', value: (loan) => loan.status },
  { header: 'Amount (XLM)', value: (loan) => String(loan.amount) },
  { header: 'Collateral ID', value: (loan) => loan.collateralId ?? '' },
  { header: 'Created At', value: (loan) => loan.createdAt },
  { header: 'Updated At', value: (loan) => loan.updatedAt ?? '' },
];

/** Maps loan status to design-token badge classes (WCAG AA compliant). */
function statusBadgeClasses(status: string): string {
  switch (status) {
    case 'active':
      return 'bg-success-light text-success-dark';
    case 'repaid':
      return 'bg-gold-100 text-gold-700 dark:bg-gold-900/40 dark:text-gold-300';
    case 'liquidated':
      return 'bg-error-light text-error-dark';
    default:
      return 'bg-brown-100 text-brown-600 dark:bg-brown-700 dark:text-brown-300';
  }
}

/** Inline status badge rendered inside the Card `badge` slot. */
function LoanStatusBadge({ status, reduced }: { status: string; reduced: boolean | null }) {
  return (
    <motion.span
      key={status}
      variants={reduced ? undefined : badgeVariants}
      initial="initial"
      animate="animate"
      className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusBadgeClasses(status)}`}
    >
      {status}
    </motion.span>
  );
}

/** Export button that generates a CSV of the currently-filtered loan list. */
function ExportCsvButton({ loans }: { loans: Loan[] }) {
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      // Small async yield so the browser can re-render the disabled/spinner state
      await Promise.resolve();
      const csv = toCsvString(loans, LOAN_CSV_COLUMNS);
      downloadCsv(csv, csvFilename('loans'));
    } finally {
      setExporting(false);
    }
  }

  return (
    <button
      onClick={handleExport}
      disabled={exporting || loans.length === 0}
      aria-label="Export loans to CSV"
      className="flex items-center gap-2 rounded-lg border border-brown/30 dark:border-gold/30 bg-white dark:bg-brown-900 px-3 py-2 text-sm font-medium text-brown dark:text-cream hover:bg-brown/5 dark:hover:bg-gold/10 transition disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
    >
      {exporting ? (
        <>
          <Spinner className="h-4 w-4" label="Generating CSV…" />
          <span>Exporting…</span>
        </>
      ) : (
        <>
          <Download className="h-4 w-4" aria-hidden="true" />
          <span>Export CSV</span>
        </>
      )}
    </button>
  );
}

function LoanListContent() {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);
  const reduced = useReducedMotion();
  const { t } = useI18n();

  // Derive dynamic min/max amounts from loaded loans
  const [amountRange, setAmountRange] = useState<[number, number]>([0, 0]);
  const [selectedAmountRange, setSelectedAmountRange] = useState<[number, number]>([0, 0]);

  // useSearchFilter manages query, status chips, date range, and URL sync
  // SearchFilterBar renders its own instance that writes to URL; this instance
  // reads back from the URL so LoanListContent can filter the in-memory list.
  const {
    filters,
    debouncedQuery,
    clearAll,
    hasActiveFilters,
  } = useSearchFilter();

  useEffect(() => {
    setLoading(true);
    fetch(`${API}/api/loans`)
      .then((r) => r.json())
      .then((data: Loan[]) => {
        const list = Array.isArray(data) ? data : [];
        setLoans(list);
        if (list.length > 0) {
          const amounts = list.map((l) => l.amount);
          const minAmt = Math.min(...amounts);
          const maxAmt = Math.max(...amounts);
          setAmountRange([minAmt, maxAmt]);
          setSelectedAmountRange([minAmt, maxAmt]);
        }
      })
      .catch(() => setLoans([]))
      .finally(() => setLoading(false));
  }, []);

  const hasAmountFilter =
    amountRange[0] !== amountRange[1] &&
    (selectedAmountRange[0] !== amountRange[0] || selectedAmountRange[1] !== amountRange[1]);

  const filtered = loans.filter((loan) => {
    // Text search: ID or collateral ID (case-insensitive)
    const matchesQuery =
      !debouncedQuery ||
      loan.id.toLowerCase().includes(debouncedQuery.toLowerCase()) ||
      loan.borrower.toLowerCase().includes(debouncedQuery.toLowerCase());

    // Status chip filter
    const matchesStatus =
      filters.statuses.length === 0 || filters.statuses.includes(loan.status);

    // Amount range filter
    const matchesAmount =
      !hasAmountFilter ||
      (loan.amount >= selectedAmountRange[0] && loan.amount <= selectedAmountRange[1]);

    // Date range filter
    const loanDate = new Date(loan.createdAt);
    const matchesDateFrom = !filters.dateFrom || loanDate >= new Date(filters.dateFrom);
    const matchesDateTo = !filters.dateTo || loanDate <= new Date(filters.dateTo);

    return matchesQuery && matchesStatus && matchesAmount && matchesDateFrom && matchesDateTo;
  });

  const handleClearAll = () => {
    clearAll();
    setSelectedAmountRange(amountRange);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <SearchFilterBar
          statusOptions={STATUS_OPTIONS}
          typeOptions={TYPE_OPTIONS}
          searchPlaceholder="Search by loan ID, borrower, or status…"
        />
        {/* Export button — closes #1203: active filters applied before export */}
        <ExportCsvButton loans={filtered} />
      </div>
      {loading ? (
        <p className="text-brown/60 text-sm" role="status" aria-live="polite">
          {t('loans.loading', 'Loading…')}
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-brown/60 text-sm" role="status" aria-live="polite">
          {t('loans.noResults', 'No loans match your filters.')}
        </p>
      ) : (
        <ul className="space-y-2" aria-label={t('loans.title', 'Loans')}>
          {filtered.map((loan) => (
            <li key={loan.id}>
              <Card
                title={`${t('loans.loanId', 'Loan')} #${loan.id}`}
                subtitle={loan.borrower}
                badge={<LoanStatusBadge status={loan.status} reduced={reduced} />}
                action={
                  <span className="text-sm font-medium text-brown-700 dark:text-cream-100">
                    {loan.amount.toLocaleString()} XLM
                  </span>
                }
                aria-label={`${t('loans.loanId', 'Loan')} ${loan.id}, ${loan.status}, ${loan.amount.toLocaleString()} XLM`}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function LoansListClient() {
  useScrollPosition();
  const { t } = useI18n();

  return (
    <PageTransition>
      <main className="max-w-3xl mx-auto px-4 py-10">
        <h1 className="text-3xl font-bold text-brown mb-6">{t('loans.title', 'Loans')}</h1>
        <Suspense
          fallback={
            <ul className="space-y-3 mt-4" aria-busy="true" aria-label="Loading loans">
              {[...Array(5)].map((_, i) => (
                <li
                  key={i}
                  className="bg-white dark:bg-brown-900 rounded-xl p-4 shadow-sm border border-brown/10 flex justify-between items-center"
                  aria-hidden="true"
                >
                  <div className="space-y-2">
                    <div className="skeleton-shimmer rounded h-4 w-24" />
                    <div className="skeleton-shimmer rounded h-3 w-44" />
                  </div>
                  <div className="text-right space-y-2">
                    <div className="skeleton-shimmer rounded h-4 w-20" />
                    <div className="skeleton-shimmer rounded h-5 w-16 rounded-full" />
                  </div>
                </li>
              ))}
            </ul>
          }
        >
          <LoanListContent />
        </Suspense>
      </main>
      <ScrollToTopButton />
    </PageTransition>
  );
}
