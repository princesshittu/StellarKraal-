'use client';

import { useId, useState, type ReactNode } from 'react';
import { GlossaryTerm } from '@/components/GlossaryTerm';
import { Button } from '@/components/ui';
import { useWizard } from '@/context/LoanWizardContext';
import { useCurrencyConversion } from '@/hooks/useCurrencyConversion';

const TERM_RATES: Record<string, string> = {
  '7': '2%',
  '30': '5%',
  '90': '12%',
  '180': '20%',
};

interface ReviewRow {
  label: ReactNode;
  value: ReactNode;
  emphasis?: boolean;
}

interface AmountBreakdownTooltipProps {
  principal: number;
  originationFee: number;
  estimatedFirstInterest: number;
}

function AmountBreakdownTooltip({
  principal,
  originationFee,
  estimatedFirstInterest,
}: AmountBreakdownTooltipProps) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();
  const { rates } = useCurrencyConversion();
  const usdRate = rates?.USD ?? null;

  const formatXlm = (stroops: number) => `${(stroops / 1e7).toFixed(2)} XLM`;
  const formatFiat = (stroops: number) => {
    if (!usdRate) return null;
    return `$${((stroops / 1e7) * usdRate).toFixed(2)} USD`;
  };

  const items = [
    { label: 'Principal', value: principal },
    { label: 'Origination Fee', value: originationFee },
    { label: 'Est. First Interest', value: estimatedFirstInterest },
  ];

  return (
    <span className="relative ml-1 inline-flex items-center align-middle">
      <button
        type="button"
        onClick={() => setOpen((visible) => !visible)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setOpen((visible) => !visible);
          }
          if (event.key === 'Escape') setOpen(false);
        }}
        aria-label="Amount breakdown"
        aria-expanded={open}
        aria-controls={tooltipId}
        aria-describedby={open ? tooltipId : undefined}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-gold-700 transition hover:bg-gold/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 dark:text-gold-300"
      >
        <svg
          aria-hidden="true"
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </button>

      {open && (
        <div
          id={tooltipId}
          role="tooltip"
          className="absolute bottom-full left-1/2 z-50 mb-2 w-64 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-lg bg-brown-900 p-3 text-left text-sm text-cream-50 shadow-lg dark:bg-cream-50 dark:text-brown-900"
        >
          <div className="mb-2 font-semibold">Amount Breakdown</div>
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.label} className="flex items-start justify-between gap-3">
                <span>{item.label}</span>
                <span className="shrink-0 text-right font-mono">
                  {formatXlm(item.value)}
                  {formatFiat(item.value) && (
                    <span className="block text-xs opacity-75">{formatFiat(item.value)}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}

export default function StepReview() {
  const { animalType, count, appraisedValue, loanAmount, loanTermDays, nextStep, prevStep } =
    useWizard();
  const [isDetailedView, setIsDetailedView] = useState(false);

  const rate = TERM_RATES[loanTermDays] || '5%';
  const principal = Number.parseInt(loanAmount || '0', 10);
  const appraisedValueInt = Number.parseInt(appraisedValue || '0', 10);
  const fee = Math.floor(principal * (Number.parseFloat(rate) / 100));
  const estimatedFirstInterest = Math.floor(principal * 0.01);
  const totalRepay = principal + fee;
  // Round to 2 decimal places to prevent floating-point artefacts (e.g. 74.99999999%)
  const ltvPct =
    principal > 0 && appraisedValueInt > 0
      ? ((principal / appraisedValueInt) * 100).toFixed(2)
      : '0.00';
  // origination fee as percentage of principal rounded to 2 d.p.
  const feePct = principal > 0 ? ((fee / principal) * 100).toFixed(2) : '0.00';
  const healthFactor =
    principal > 0 && appraisedValueInt > 0
      ? (appraisedValueInt / principal / 1.5).toFixed(2)
      : '—';
  const animalLabel = `${animalType.charAt(0).toUpperCase()}${animalType.slice(1)}`;
  const breakdown = (
    <AmountBreakdownTooltip
      principal={principal}
      originationFee={fee}
      estimatedFirstInterest={estimatedFirstInterest}
    />
  );

  const rows: ReviewRow[] = [
    {
      label: <GlossaryTerm termKey="collateral">Collateral Type</GlossaryTerm>,
      value: animalLabel,
    },
    { label: 'Animal Count', value: count },
    {
      label: <GlossaryTerm termKey="appraisal">Appraised Value</GlossaryTerm>,
      value: `${appraisedValueInt.toLocaleString()} stroops`,
    },
    {
      label: <GlossaryTerm termKey="loanAmount">Loan Amount</GlossaryTerm>,
      value: `${principal.toLocaleString()} stroops`,
    },
    {
      label: <GlossaryTerm termKey="ltv">LTV</GlossaryTerm>,
      value: `${ltvPct}%`,
    },
    { label: 'Loan Term', value: `${loanTermDays} days` },
    {
      label: <GlossaryTerm termKey="feeRate">Fee Rate</GlossaryTerm>,
      value: rate,
    },
    {
      label: <GlossaryTerm termKey="originationFee">Fee Amount</GlossaryTerm>,
      value: `${fee.toLocaleString()} stroops (${feePct}%)`,
    },
    {
      label: <GlossaryTerm termKey="repayment">Total to Repay</GlossaryTerm>,
      value: (
        <span className="inline-flex flex-wrap items-center justify-end gap-1">
          {totalRepay.toLocaleString()} stroops
          {breakdown}
        </span>
      ),
      emphasis: true,
    },
    {
      label: <GlossaryTerm termKey="healthFactor">Health Factor</GlossaryTerm>,
      value: healthFactor,
      emphasis: true,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-brown-800 dark:text-cream-50">Review Loan Terms</h2>
        <div
          aria-live="polite"
          className="mt-2 inline-flex flex-wrap items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-3 py-1.5 text-xs font-medium text-brown-700 dark:border-gold-700 dark:bg-brown-800 dark:text-cream-100"
        >
          <span className="flex items-center gap-1.5">
            <svg
              aria-hidden="true"
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            {isDetailedView ? 'About 2 minute read' : 'About 1 minute read'}
          </span>
          <span aria-hidden="true" className="h-1 w-1 rounded-full bg-gold" />
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="flex items-end gap-0.5">
              <span
                className={`h-2 w-1 rounded-sm ${isDetailedView ? 'bg-gold-700' : 'bg-gold'}`}
              />
              <span
                className={`h-3 w-1 rounded-sm ${isDetailedView ? 'bg-gold-700' : 'bg-gold'}`}
              />
              <span
                className={`h-4 w-1 rounded-sm ${isDetailedView ? 'bg-gold-700' : 'bg-gold/40'}`}
              />
            </span>
            {isDetailedView ? 'High complexity' : 'Low complexity'}
          </span>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setIsDetailedView((detailed) => !detailed)}
          aria-expanded={isDetailedView}
          aria-controls="loan-terms-content"
          className="rounded-md text-sm font-semibold text-gold-700 underline underline-offset-2 transition hover:text-gold focus:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 dark:text-gold-300"
        >
          {isDetailedView ? 'Show simplified view' : 'Show full terms'}
        </button>
      </div>

      {isDetailedView ? (
        <section
          id="loan-terms-content"
          aria-labelledby="detailed-terms-heading"
          className="rounded-2xl border border-brown/20 bg-white shadow-sm dark:border-brown-700 dark:bg-brown-900"
        >
          <h3
            id="detailed-terms-heading"
            className="border-b border-brown/10 px-4 py-4 text-lg font-semibold text-brown-800 dark:border-brown-700 dark:text-cream-50"
          >
            Full Loan Terms
          </h3>
          <dl className="divide-y divide-brown/10 dark:divide-brown-700">
            {rows.map(({ label, value, emphasis }, index) => (
              <div
                key={index}
                className={`grid min-w-0 grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4 ${
                  emphasis ? 'bg-gold/5 dark:bg-gold/10' : ''
                }`}
              >
                <dt
                  className={`min-w-0 break-words text-sm ${
                    emphasis
                      ? 'font-semibold text-brown-800 dark:text-cream-50'
                      : 'text-brown-700 dark:text-cream-200'
                  }`}
                >
                  {label}
                </dt>
                <dd
                  className={`min-w-0 break-words text-sm sm:text-right ${
                    emphasis
                      ? 'font-bold text-brown-800 dark:text-cream-50'
                      : 'text-brown-800 dark:text-cream-100'
                  }`}
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : (
        <section
          id="loan-terms-content"
          aria-labelledby="simplified-terms-heading"
          className="rounded-2xl border border-brown/20 bg-white p-5 shadow-sm dark:border-brown-700 dark:bg-brown-900"
        >
          <h3
            id="simplified-terms-heading"
            className="mb-3 text-lg font-semibold text-brown-800 dark:text-cream-50"
          >
            Loan Summary
          </h3>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-brown-700 dark:text-cream-200">
            <li>
              You are borrowing <strong>{principal.toLocaleString()} stroops</strong>.
            </li>
            <li>
              You will use{' '}
              <strong>
                {count} {animalType}s
              </strong>{' '}
              as collateral.
            </li>
            <li>
              The loan must be repaid in <strong>{loanTermDays} days</strong>.
            </li>
            <li>
              You will owe a total of <strong>{totalRepay.toLocaleString()} stroops</strong>{' '}
              including fees.
              {breakdown}
            </li>
            <li>If you fail to repay, your collateral may be seized.</li>
          </ul>
        </section>
      )}

      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
        <svg
          aria-hidden="true"
          className="mt-0.5 h-5 w-5 shrink-0"
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
        <p className="text-sm">
          If the health factor drops below 1.0, your collateral may be liquidated. Monitor your
          position regularly.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button variant="ghost" className="w-full sm:flex-1" onClick={prevStep}>
          Back
        </Button>
        <Button className="w-full sm:flex-[2]" onClick={nextStep}>
          Confirm and submit
        </Button>
      </div>
    </div>
  );
}
