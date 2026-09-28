'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

interface UseInfiniteScrollOptions<T> {
  /** Async function that fetches a page. Receives (page, pageSize). */
  fetchPage: (page: number, pageSize: number) => Promise<T[]>;
  /** Number of items per page (default 20). */
  pageSize?: number;
  /** Margin before the sentinel triggers loading (default '200px'). */
  rootMargin?: string;
}

interface UseInfiniteScrollResult<T> {
  /** All accumulated items loaded so far. */
  items: T[];
  /** True while the current page is being fetched. */
  loading: boolean;
  /** True once all items have been loaded (last page returned < pageSize items). */
  hasMore: boolean;
  /** Error message if the last fetch failed. */
  error: string | null;
  /** Ref to attach to the sentinel element that triggers loading the next page. */
  sentinelRef: React.RefCallback<HTMLElement>;
  /** Resets state and re-fetches from page 1. */
  reset: () => void;
}

/**
 * Infinite scroll hook using IntersectionObserver.
 * When the sentinel element becomes visible, the next page is fetched and
 * appended to `items`. Loading stops when a page returns fewer items than
 * `pageSize`, signalling the end of the list.
 *
 * Back/forward navigation scroll position is handled by the caller via
 * useScrollPosition which persists and restores the scroll offset in
 * sessionStorage.
 */
export function useInfiniteScroll<T>({
  fetchPage,
  pageSize = 20,
  rootMargin = '200px',
}: UseInfiniteScrollOptions<T>): UseInfiniteScrollResult<T> {
  const [items, setItems] = useState<T[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Guard against concurrent fetches
  const fetchingRef = useRef(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelNodeRef = useRef<HTMLElement | null>(null);

  const loadPage = useCallback(
    async (pageNum: number) => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      setLoading(true);
      setError(null);
      try {
        const data = await fetchPage(pageNum, pageSize);
        setItems((prev) => (pageNum === 1 ? data : [...prev, ...data]));
        if (data.length < pageSize) {
          setHasMore(false);
        } else {
          setPage(pageNum + 1);
        }
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Failed to load items');
      } finally {
        setLoading(false);
        fetchingRef.current = false;
      }
    },
    [fetchPage, pageSize]
  );

  // Initial load
  useEffect(() => {
    loadPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-observe sentinel when it becomes available / hasMore changes
  const attachObserver = useCallback(
    (node: HTMLElement | null) => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      sentinelNodeRef.current = node;
      if (!node || !hasMore) return;

      observerRef.current = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting && !fetchingRef.current) {
            setPage((current) => {
              loadPage(current);
              return current;
            });
          }
        },
        { rootMargin }
      );
      observerRef.current.observe(node);
    },
    // loadPage is stable; hasMore triggers re-attach when it changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasMore, rootMargin]
  );

  // Re-attach observer whenever hasMore changes (e.g. after reset)
  useEffect(() => {
    if (sentinelNodeRef.current) {
      attachObserver(sentinelNodeRef.current);
    }
    return () => {
      observerRef.current?.disconnect();
    };
  }, [attachObserver]);

  const reset = useCallback(() => {
    setItems([]);
    setPage(1);
    setHasMore(true);
    setError(null);
    fetchingRef.current = false;
    loadPage(1);
  }, [loadPage]);

  return { items, loading, hasMore, error, sentinelRef: attachObserver, reset };
}
