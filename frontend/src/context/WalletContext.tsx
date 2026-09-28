"use client";
/**
 * WalletContext — Issue #1208
 *
 * Wraps useWallet and adds auth-aware disconnect behaviour:
 *  - Clears the `session` JWT cookie on disconnect
 *  - Redirects to `/` after disconnect
 *  - Exposes `isAuthenticated` derived from address presence
 *
 * Protected pages should use this context to gate access.
 */
import React, {
  createContext,
  useContext,
  useCallback,
  useMemo,
} from "react";
import { useRouter } from "next/navigation";
import { useWallet, type WalletState } from "@/hooks/useWallet";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WalletContextValue extends WalletState {
  /** True when a wallet address is present (user is connected). */
  isAuthenticated: boolean;
  /**
   * Disconnect the wallet, clear the JWT session cookie, and redirect to `/`.
   * This is the canonical disconnect action to use throughout the app.
   */
  disconnectAndClear: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Clears the `session` JWT cookie that the backend sets on login.
 * Works in all modern browsers — sets Max-Age=0 to immediately expire the cookie.
 */
function clearSessionCookie(): void {
  if (typeof document === "undefined") return;
  // Expire across common path/domain combinations
  document.cookie = "session=; path=/; max-age=0; SameSite=Lax";
  document.cookie = "session=; path=/; max-age=0; SameSite=Strict";
}

// ─── Context ──────────────────────────────────────────────────────────────────

const WalletContext = createContext<WalletContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const wallet = useWallet();
  const router = useRouter();

  /**
   * Full disconnect:
   * 1. Call the base `disconnect()` which clears address state + localStorage
   * 2. Expire the JWT session cookie
   * 3. Redirect to home page
   */
  const disconnectAndClear = useCallback(() => {
    wallet.disconnect();
    clearSessionCookie();
    router.push("/");
  }, [wallet, router]);

  const isAuthenticated = Boolean(wallet.address);

  const value = useMemo<WalletContextValue>(
    () => ({
      ...wallet,
      isAuthenticated,
      disconnectAndClear,
    }),
    [wallet, isAuthenticated, disconnectAndClear]
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useWalletContext — use this in components that need the full auth-aware
 * wallet state (isAuthenticated, disconnectAndClear).
 *
 * Falls back gracefully when used outside the WalletProvider (returns null
 * for isAuthenticated, noop for disconnectAndClear) so existing code that
 * only consumes `useWallet()` keeps working.
 */
export function useWalletContext(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error("useWalletContext must be used within a WalletProvider");
  }
  return ctx;
}
