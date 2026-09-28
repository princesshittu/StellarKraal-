import { useCallback, useEffect, useRef } from 'react';

/**
 * Persists and restores wizard state to/from sessionStorage.
 *
 * sessionStorage survives page reloads within the same tab but is cleared when
 * the tab is closed — making it the right choice for in-progress form data that
 * the user shouldn't unexpectedly find hours later.
 *
 * Optionally scoped by `walletAddress` so that switching wallets in the same
 * tab does not restore another wallet's draft.
 */

const SESSION_STORAGE_KEY = 'loan_wizard_session_state';

interface PersistedEntry<T> {
  walletAddress?: string;
  data: T;
  savedAt: number; // Date.now()
}

interface UseWizardPersistOptions<T> {
  /** Key to store state under in sessionStorage. */
  storageKey?: string;
  /** When provided, saved state is only restored for the same wallet. */
  walletAddress?: string;
}

interface UseWizardPersistResult<T> {
  /**
   * Write the current wizard state to sessionStorage immediately.
   * Should be called on every change (the caller is responsible for debouncing
   * if needed, but for step transitions immediate writes are fine).
   */
  persist: (data: T) => void;
  /**
   * Read and return the previously persisted state.
   * Returns null if nothing is saved, the wallet doesn't match, or the entry
   * cannot be parsed.
   */
  restore: () => T | null;
  /**
   * Remove the persisted entry from sessionStorage.
   * Call on wizard completion or cancellation.
   */
  clear: () => void;
}

export function useWizardPersist<T>({
  storageKey = SESSION_STORAGE_KEY,
  walletAddress,
}: UseWizardPersistOptions<T> = {}): UseWizardPersistResult<T> {
  // Keep walletAddress in a ref so callbacks don't need to re-bind on every render
  const walletRef = useRef(walletAddress);
  useEffect(() => {
    walletRef.current = walletAddress;
  }, [walletAddress]);

  const persist = useCallback(
    (data: T) => {
      try {
        const entry: PersistedEntry<T> = {
          data,
          savedAt: Date.now(),
          ...(walletRef.current ? { walletAddress: walletRef.current } : {}),
        };
        sessionStorage.setItem(storageKey, JSON.stringify(entry));
      } catch {
        // sessionStorage unavailable (e.g. private mode quota) — fail silently
      }
    },
    [storageKey]
  );

  const restore = useCallback((): T | null => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return null;
      const entry: PersistedEntry<T> = JSON.parse(raw);
      // Wallet mismatch — don't restore
      if (walletRef.current && entry.walletAddress && entry.walletAddress !== walletRef.current) {
        return null;
      }
      return entry.data ?? null;
    } catch {
      return null;
    }
  }, [storageKey]);

  const clear = useCallback(() => {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
  }, [storageKey]);

  return { persist, restore, clear };
}
