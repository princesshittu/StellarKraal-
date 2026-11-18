'use client';
import useSWR from 'swr';
import { API, fetcher } from '@/lib/api';

export interface Loan {
  id: string;
  borrower: string;
  amount: number;
  status: string;
  createdAt: string;
}

interface LoansResponse {
  data?: Loan[];
}

const LOANS_KEY = `${API}/api/loans`;

/**
 * Cached, background-revalidated list of all loans. Replaces per-page
 * `useEffect + fetch` so navigating between pages serves stale data instantly
 * while SWR refreshes it.
 *
 * Pass `refreshInterval` to keep a page polling. When `refreshInterval > 0`,
 * SWR also revalidates on tab focus so users returning to a hidden tab see
 * fresh data immediately (issue #1535).
 */
export function useLoans(options?: { refreshInterval?: number }) {
  const { data, error, isLoading, mutate } = useSWR<Loan[] | LoansResponse>(LOANS_KEY, fetcher, {
    refreshInterval: options?.refreshInterval ?? 0,
    // Re-fetch when the tab regains focus — complements the interval so the
    // first visible frame after a background period shows current status.
    revalidateOnFocus: (options?.refreshInterval ?? 0) > 0,
  });

  const loans: Loan[] = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];

  return {
    loans,
    isLoading,
    error: error ? (error as Error).message : null,
    refresh: () => mutate(),
  };
}

/**
 * Cached single loan lookup by id. Returns `undefined` while the id is empty so
 * SWR skips the request until one is provided.
 */
export function useLoan(id: string | null | undefined) {
  const key = id ? `${API}/api/loan/${id}` : null;
  const { data, error, isLoading, mutate } = useSWR<unknown>(key, fetcher);

  return {
    loan: data ?? null,
    isLoading,
    error: error ? (error as Error).message : null,
    refresh: () => mutate(),
  };
}
