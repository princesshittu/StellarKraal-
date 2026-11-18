"use client";
/**
 * useLoanStatusPolling — real-time loan status updates (issue #1535).
 *
 * Polls the loans API on a fixed interval so that dashboard health factor
 * values and loan state badges update automatically after on-chain events
 * (e.g. health factor drops, liquidations) without a manual page refresh.
 *
 * Behaviour:
 *  - Default interval is 15 seconds (NEXT_PUBLIC_LOAN_POLL_INTERVAL_MS).
 *  - Polling pauses when the browser tab is hidden and resumes (with an
 *    immediate fetch) when the tab becomes visible again.
 *  - Set NEXT_PUBLIC_LOAN_POLL_INTERVAL_MS=0 to disable polling entirely
 *    (useful in test environments or when SSE is preferred).
 *
 * Usage:
 *   const { loans, isLoading, error } = useLoanStatusPolling();
 */
import { useLoans, type Loan } from "./useLoans";

/**
 * Polling interval in milliseconds, read from the environment variable
 * NEXT_PUBLIC_LOAN_POLL_INTERVAL_MS.  Falls back to 15 000 ms (15 s).
 * Setting the variable to "0" disables automatic polling.
 */
const DEFAULT_POLL_INTERVAL_MS = 15_000;

function getConfiguredInterval(): number {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_LOAN_POLL_INTERVAL_MS !== undefined) {
    const parsed = parseInt(process.env.NEXT_PUBLIC_LOAN_POLL_INTERVAL_MS, 10);
    if (!isNaN(parsed) && parsed >= 0) return parsed;
  }
  return DEFAULT_POLL_INTERVAL_MS;
}

export interface UseLoanStatusPollingResult {
  loans: Loan[];
  isLoading: boolean;
  error: string | null;
  /** Trigger an immediate re-fetch outside the normal interval. */
  refresh: () => void;
  /** Configured polling interval in ms (0 = disabled). */
  pollIntervalMs: number;
}

/**
 * Subscribe to periodic loan status updates.
 *
 * SWR handles tab-visibility pausing automatically via its `revalidateOnFocus`
 * option; the `usePolling` hook's `visibilitychange` listener also ensures the
 * interval itself stops while the tab is hidden.
 *
 * @param overrideIntervalMs - Override the env-configured interval for this
 *   specific call site (e.g., a detail page that needs a faster refresh).
 */
export function useLoanStatusPolling(
  overrideIntervalMs?: number
): UseLoanStatusPollingResult {
  const pollIntervalMs =
    overrideIntervalMs !== undefined
      ? overrideIntervalMs
      : getConfiguredInterval();

  const { loans, isLoading, error, refresh } = useLoans({
    refreshInterval: pollIntervalMs,
  });

  return { loans, isLoading, error, refresh, pollIntervalMs };
}
