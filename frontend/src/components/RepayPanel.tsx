"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { signTransaction } from "@/lib/freighterClient";
import { submitSignedXdr } from "@/lib/stellarUtils";
import { invalidateLoans, throwIfNotOk } from "@/lib/api";
import { classifyApiError } from "@/lib/apiErrorToast";
import Tooltip from "@/components/Tooltip";
import { colors } from "@/lib/design-tokens";
import Card from "@/components/Card";
import Spinner from "@/components/Spinner";
import { useToast } from "@/components/toast";
import { useNetworkMismatch } from "@/hooks/useNetworkMismatch";
import { useTransactionStatus } from "@/hooks/useTransactionStatus";

interface Props {
  walletAddress: string;
  /** Pre-fill the loan ID field (e.g. from the calculator panel) */
  initialLoanId?: string;
  /** Pre-fill the amount field (stroops) */
  initialAmount?: string;
}

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export default function RepayPanel({ walletAddress }: Props) {
  const router = useRouter();
  const [loanId, setLoanId] = useState("");
  const [amount, setAmount] = useState("");
  /**
   * `submitting` tracks whether a repayment request is in-flight.
   *
   * — Closes #1204: the submit button is disabled immediately on the first
   *   click and stays disabled until the network response (success OR error)
   *   arrives, preventing duplicate submissions.
   * — On error, `submitting` is set back to false so the user can retry.
   */
  const [submitting, setSubmitting] = useState(false);
  const [pendingHash, setPendingHash] = useState<string | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [isStickyVisible, setIsStickyVisible] = useState(false);
  const toast = useToast();
  const networkMismatch = useNetworkMismatch(walletAddress);
  const mainButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        // Show sticky bar when main button is not intersecting (out of view)
        setIsStickyVisible(!entry.isIntersecting);
      },
      { threshold: 0 }
    );

    if (mainButtonRef.current) {
      observer.observe(mainButtonRef.current);
    }

    return () => observer.disconnect();
  }, []);

  /**
   * Repayment handler — closes #1204.
   *
   * The button is disabled immediately on click via `submitting` state.
   * The finally-block resets `submitting` to false on both success and error,
   * so the user can retry after a failure.
   */
  async function repay() {
    // Guard: ignore if already in-flight (e.g. keyboard-Enter spamming)
    if (submitting) return;

    setSubmitting(true);
    setPendingError(null);
    try {
      const idempotencyKey =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const res = await fetch(`${API}/api/loan/repay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          borrower: walletAddress,
          loan_id: parseInt(loanId, 10),
          amount: parseInt(amount, 10),
        }),
      });
      await throwIfNotOk(res);
      const { xdr } = await res.json();
      const { signedTxXdr } = await signTransaction(xdr, {
        network: process.env.NEXT_PUBLIC_NETWORK || 'TESTNET',
      });
      const hash = await submitSignedXdr(signedTxXdr);
      setPendingHash(hash);
      invalidateLoans();
    } catch (e) {
      const { variant, message } = classifyApiError(e);
      toast[variant](message);
      // Re-enable the button on error so the user can retry — closes #1204
    } finally {
      setSubmitting(false);
    }
  }

  function handleTxTerminal(status: "confirmed" | "failed", errorCode?: string) {
    if (status === "confirmed") {
      toast.success("Repayment submitted successfully!");
      setLoanId("");
      setAmount("");
    } else if (status === "failed") {
      const msg = errorCode ? `Transaction failed: ${errorCode}` : 'Transaction failed';
      setPendingError(msg);
      toast.error(msg);
    }
    setPendingHash(null);
  }

  useTransactionStatus(pendingHash, {
    interval: 3000,
    onTerminal: handleTxTerminal,
  });

  function scrollToForm() {
    mainButtonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /** The button is disabled when a submission is in-flight or the network is wrong. */
  const isButtonDisabled = submitting || networkMismatch;

  return (
    <>
      <Card
        className="mb-4"
        header={<h2 className={`text-xl font-semibold ${colors.text.primary}`}>Repay Loan</h2>}
      >
        <div className="space-y-3 pb-4">
          <input
            className={`w-full ${colors.form.input} rounded-lg px-3 py-2 ${colors.text.primary} ${colors.form.placeholder}`}
            placeholder="Loan ID"
            value={loanId}
            onChange={(e) => setLoanId(e.target.value)}
            type="number"
            disabled={submitting}
            aria-label="Loan ID"
          />
          <input
            className={`w-full ${colors.form.input} rounded-lg px-3 py-2 ${colors.text.primary} ${colors.form.placeholder}`}
            placeholder="Amount (stroops)"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            type="number"
            disabled={submitting}
            aria-label="Repayment amount in stroops"
          />
          <Tooltip hint="R — Repay loan">
            {/*
             * #1204: button is disabled immediately on first click (`submitting=true`)
             * and re-enabled only after the response arrives (finally block).
             * aria-disabled mirrors the disabled prop for AT compatibility.
             */}
            <button
              ref={mainButtonRef}
              onClick={repay}
              disabled={isButtonDisabled}
              aria-disabled={isButtonDisabled}
              aria-label={submitting ? "Processing repayment…" : "Repay loan"}
              className={`w-full ${colors.secondary.bg} ${colors.secondary.text} py-2.5 rounded-xl font-semibold ${colors.secondary.hover} transition ${colors.interactive.disabled} ${colors.interactive.focus} flex items-center justify-center gap-2`}
            >
              {submitting ? (
                <>
                  <Spinner label="Processing repayment…" />
                  Processing…
                </>
              ) : "Repay"}
            </button>
          </Tooltip>
          {pendingHash && (
            <div className="p-3 rounded-xl text-sm bg-amber-50 border border-amber-200 text-amber-800" role="status" aria-live="polite">
              <p className="font-medium">Transaction pending confirmation...</p>
              <p className="font-mono text-xs mt-1 break-all">{pendingHash}</p>
              {pendingError && <p className="text-red-600 mt-1">{pendingError}</p>}
            </div>
          )}
        </div>
      </Card>

      {/* Sticky CTA for Mobile */}
      <div
        className={`sm:hidden fixed bottom-0 left-0 right-0 p-4 bg-white dark:bg-[#1A1005] border-t border-brown/10 dark:border-gold/20 shadow-2xl z-50 transition-opacity duration-150 ${isStickyVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
      >
        <button
          onClick={scrollToForm}
          disabled={isButtonDisabled}
          aria-disabled={isButtonDisabled}
          className="w-full bg-gold text-brown py-3 rounded-xl font-bold shadow-md active:scale-[0.98] transition-transform disabled:opacity-50"
        >
          {submitting ? "Processing…" : "Repay Loan"}
        </button>
      </div>
    </>
  );
}
