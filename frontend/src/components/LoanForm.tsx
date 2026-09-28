'use client';
import { useState } from 'react';
import { signTransaction } from '@/lib/freighterClient';
import { submitSignedXdr } from '@/lib/stellarUtils';
import { colors } from '@/lib/design-tokens';
import Spinner from '@/components/Spinner';
import { useToast } from '@/components/toast';
import { Input, Select, ErrorSummary, toSummaryErrors } from '@/components/ui';
import FieldTooltip from '@/components/FieldTooltip';
import { useFetchWithRateLimit } from '@/hooks/useFetchWithRateLimit';
import { useNetworkMismatch } from '@/hooks/useNetworkMismatch';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useTransactionStatus } from '@/hooks/useTransactionStatus';
import { throwIfNotOk } from '@/lib/api';
import { classifyApiError } from '@/lib/apiErrorToast';

interface Props {
  walletAddress: string;
  initialCollateralId?: string;
}

const ANIMAL_TYPES = ['cattle', 'goat', 'sheep'];
const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const COLLATERAL_FIELD_IDS = {
  count: 'loan-count',
  appraisedValue: 'loan-appraised-value',
};

const LOAN_FIELD_IDS = {
  collateralId: 'loan-collateral-id',
  loanAmount: 'loan-amount',
};

function validateCount(v: string): string | null {
  if (!v.trim()) return 'Count is required.';
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) return 'Count must be a whole number of at least 1.';
  if (n > 10_000) return 'Count cannot exceed 10,000.';
  return null;
}

function validateAppraisedValue(v: string): string | null {
  if (!v.trim()) return 'Appraised value is required.';
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 'Appraised value must be a positive number.';
  if (!Number.isInteger(n)) return 'Appraised value must be a whole number of stroops.';
  return null;
}

function validateCollateralId(v: string): string | null {
  if (!v.trim()) return 'Collateral ID is required.';
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) return 'Collateral ID must be a positive integer.';
  return null;
}

function validateLoanAmount(v: string): string | null {
  if (!v.trim()) return 'Loan amount is required.';
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 'Loan amount must be a positive number.';
  if (!Number.isInteger(n)) return 'Loan amount must be a whole number of stroops.';
  if (n < 1_000) return 'Loan amount must be at least 1,000 stroops.';
  return null;
}

export default function LoanForm({ walletAddress, initialCollateralId }: Props) {
  const [step, setStep] = useState<'collateral' | 'loan'>(
    initialCollateralId ? 'loan' : 'collateral'
  );
  const [animalType, setAnimalType] = useState('cattle');
  const [count, setCount] = useState('');
  const [appraisedValue, setAppraisedValue] = useState('');
  const [collateralId, setCollateralId] = useState(initialCollateralId || '');
  const [loanAmount, setLoanAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [collateralPendingHash, setCollateralPendingHash] = useState<string | null>(null);
  const [loanPendingHash, setLoanPendingHash] = useState<string | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const toast = useToast();
  const { retryCountdown, isRateLimited, fetchWithLimit } = useFetchWithRateLimit();
  const networkMismatch = useNetworkMismatch(walletAddress);
  const { isOnline } = useNetworkStatus();

  const collateralErrors = {
    count: validateCount(count),
    appraisedValue: validateAppraisedValue(appraisedValue),
  };
  const loanErrors = {
    collateralId: validateCollateralId(collateralId),
    loanAmount: validateLoanAmount(loanAmount),
  };

  const collateralHasErrors = Object.values(collateralErrors).some(Boolean);
  const loanHasErrors = Object.values(loanErrors).some(Boolean);

  const summaryErrors =
    submitted && step === 'collateral'
      ? toSummaryErrors(collateralErrors, COLLATERAL_FIELD_IDS)
      : submitted && step === 'loan'
        ? toSummaryErrors(loanErrors, LOAN_FIELD_IDS)
        : [];

  /* Success overlay state */
  const [successOverlay, setSuccessOverlay] = useState<{
    title: string;
    message: string;
    redirect: string;
  } | null>(null);

  async function registerCollateral() {
    setSubmitted(true);
    if (collateralHasErrors) return;

    setLoading(true);
    setPendingError(null);
    try {
      const res = await fetchWithLimit(`${API}/api/collateral/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: walletAddress,
          animal_type: animalType,
          count: parseInt(count),
          appraised_value: parseInt(appraisedValue),
        }),
      });
      await throwIfNotOk(res);
      const { xdr } = await res.json();
      const { signedTxXdr } = await signTransaction(xdr, {
        network: process.env.NEXT_PUBLIC_NETWORK || 'TESTNET',
      });
      const hash = await submitSignedXdr(signedTxXdr);
      setCollateralPendingHash(hash);
      toast.success(`Collateral registered! Waiting for confirmation...`);
    } catch (e) {
      const { variant, message } = classifyApiError(e);
      toast[variant](message);
    } finally {
      setLoading(false);
    }
  }

  function handleCollateralTxTerminal(status: "confirmed" | "failed", errorCode?: string) {
    if (status === "confirmed" && collateralPendingHash) {
      toast.success(`Collateral confirmed!`);
      setSubmitted(false);
      setStep('loan');
    } else if (status === "failed") {
      const msg = errorCode ? `Transaction failed: ${errorCode}` : 'Transaction failed';
      setPendingError(msg);
      toast.error(msg);
    }
    setCollateralPendingHash(null);
  }

  useTransactionStatus(collateralPendingHash, {
    interval: 3000,
    onTerminal: handleCollateralTxTerminal,
  });

  async function requestLoan() {
    setSubmitted(true);
    if (loanHasErrors) return;

    setLoading(true);
    setPendingError(null);
    try {
      const res = await fetchWithLimit(`${API}/api/loan/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          borrower: walletAddress,
          collateral_id: parseInt(collateralId),
          amount: parseInt(loanAmount),
        }),
      });
      await throwIfNotOk(res);
      const { xdr } = await res.json();
      const { signedTxXdr } = await signTransaction(xdr, {
        network: process.env.NEXT_PUBLIC_NETWORK || 'TESTNET',
      });
      const hash = await submitSignedXdr(signedTxXdr);
      setLoanPendingHash(hash);
    } catch (e) {
      const { variant, message } = classifyApiError(e);
      toast[variant](message);
    } finally {
      setLoading(false);
    }
  }

  function handleLoanTxTerminal(status: "confirmed" | "failed", errorCode?: string) {
    if (status === "confirmed" && loanPendingHash) {
      setSuccessLoanId(loanPendingHash);
    } else if (status === "failed") {
      const msg = errorCode ? `Transaction failed: ${errorCode}` : 'Transaction failed';
      setPendingError(msg);
      toast.error(msg);
    }
    setLoanPendingHash(null);
  }

  useTransactionStatus(loanPendingHash, {
    interval: 3000,
    onTerminal: handleLoanTxTerminal,
  });

  // ── Success state ────────────────────────────────────────────────────────────

  if (successLoanId) {
    return (
      <div className="bg-white dark:bg-[#1C1008] rounded-2xl p-6 shadow border border-transparent dark:border-gold/20 mt-6">
        <FormSuccess
          title="Loan Requested!"
          summary={
            <div className="space-y-1 text-left">
              <p>
                <span className="font-medium">Loan ID:</span>{' '}
                <span data-testid="success-loan-id">{successLoanId}</span>
              </p>
              <p>
                <span className="font-medium">Collateral ID:</span>{' '}
                {collateralId}
              </p>
              <p>
                <span className="font-medium">Amount:</span>{' '}
                {parseInt(loanAmount).toLocaleString()} stroops
              </p>
            </div>
          }
          onSubmitAnother={resetToStart}
          viewDetailsHref="/loans"
          viewDetailsLabel="View My Loans"
        />
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-[#1C1008] rounded-2xl p-6 shadow border border-transparent dark:border-gold/20 mt-6 space-y-4">
      {step === 'collateral' ? (
        <form
          data-onboarding-target="loan"
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void registerCollateral();
          }}
        >
          <h2 className="text-xl font-semibold text-brown-700 dark:text-cream-50">
            1. Register Collateral
          </h2>
          <ErrorSummary errors={summaryErrors} />
          <Select
            label="Animal Type"
            value={animalType}
            onChange={(e) => setAnimalType(e.target.value)}
            disabled={loading}
          >
            {ANIMAL_TYPES.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </Select>
          <Input
            id={COLLATERAL_FIELD_IDS.count}
            label="Count"
            type="number"
            placeholder="Number of animals"
            value={count}
            onChange={(e) => setCount(e.target.value)}
            error={submitted ? (collateralErrors.count ?? undefined) : undefined}
            disabled={loading}
          />
          {/* Appraised Value with tooltip — #1095 */}
          <div>
            <div className="flex items-center gap-1 mb-1">
              <label htmlFor={COLLATERAL_FIELD_IDS.appraisedValue} className="text-sm font-medium text-brown-700">
                Appraised Value (stroops)
              </label>
              <FieldTooltip
                content="Collateral value is the total worth of your animals as determined by the appraiser. Your maximum loan is 70% of this amount."
                label="What is Appraised Value?"
              />
            </div>
            <Input
              id={COLLATERAL_FIELD_IDS.appraisedValue}
              type="number"
              placeholder="Total appraised value"
              value={appraisedValue}
              onChange={(e) => setAppraisedValue(e.target.value)}
              error={submitted ? (collateralErrors.appraisedValue ?? undefined) : undefined}
              disabled={loading}
            />
          </div>
          <button
            type="submit"
            disabled={loading || isRateLimited || networkMismatch || !isOnline}
            aria-disabled={loading || isRateLimited || networkMismatch || !isOnline}
            title={!isOnline ? "You're offline" : undefined}
            className={`w-full ${colors.primary.bg} ${colors.primary.text} py-2.5 rounded-xl font-semibold ${colors.primary.hover} transition ${colors.interactive.disabled} ${colors.interactive.focus} flex items-center justify-center gap-2`}
          >
            {loading ? (
              <>
                <Spinner />
                Processing…
              </>
            ) : isRateLimited ? (
              `Retry in ${retryCountdown}s`
            ) : !isOnline ? (
              "You're offline"
            ) : (
              'Register & Continue'
            )}
          </button>
        </form>
      ) : (
        <>
          <form
            noValidate
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void requestLoan();
            }}
          >
            <h2 className="text-xl font-semibold text-brown-700 dark:text-cream-50">
              2. Request Loan
            </h2>
            <ErrorSummary errors={summaryErrors} />
            <Input
              id={LOAN_FIELD_IDS.collateralId}
              label="Collateral ID"
              type="number"
              placeholder="Your collateral ID"
              value={collateralId}
              onChange={(e) => setCollateralId(e.target.value)}
              error={submitted ? (loanErrors.collateralId ?? undefined) : undefined}
              disabled={loading}
            />
            <Input
              id={LOAN_FIELD_IDS.loanAmount}
              label="Loan Amount (stroops)"
              type="number"
              placeholder="Amount to borrow"
              value={loanAmount}
              onChange={(e) => setLoanAmount(e.target.value)}
              error={submitted ? (loanErrors.loanAmount ?? undefined) : undefined}
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || isRateLimited || networkMismatch || !isOnline}
              aria-disabled={loading || isRateLimited || networkMismatch || !isOnline}
              title={!isOnline ? "You're offline" : undefined}
              className={`w-full ${colors.secondary.bg} ${colors.secondary.text} py-2.5 rounded-xl font-semibold ${colors.secondary.hover} transition ${colors.interactive.disabled} ${colors.interactive.focus} flex items-center justify-center gap-2`}
            >
              {loading ? (
                <>
                  <Spinner />
                  Processing…
                </>
              ) : isRateLimited ? (
                `Retry in ${retryCountdown}s`
              ) : !isOnline ? (
                "You're offline"
              ) : (
                'Request Loan'
              )}
            </button>
          </form>
          {(collateralPendingHash || loanPendingHash) && (
            <div className="mt-3 p-3 rounded-xl text-sm bg-amber-50 border border-amber-200 text-amber-800" role="status" aria-live="polite">
              <p className="font-medium">Transaction pending confirmation...</p>
              <p className="font-mono text-xs mt-1 break-all">{collateralPendingHash || loanPendingHash}</p>
              {pendingError && <p className="text-red-600 mt-1">{pendingError}</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
