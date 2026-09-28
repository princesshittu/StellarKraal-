"use client";
/**
 * ProtectedRoute — Issue #1208
 *
 * Wraps page content that requires a connected wallet.
 * If no wallet address is present the user is redirected to `/`.
 *
 * Usage:
 *   <ProtectedRoute>
 *     <MyPage />
 *   </ProtectedRoute>
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/hooks/useWallet";
import Spinner from "@/components/Spinner";

interface Props {
  children: React.ReactNode;
  /** Custom redirect target (defaults to '/'). */
  redirectTo?: string;
}

export default function ProtectedRoute({ children, redirectTo = "/" }: Props) {
  const { address, freighterInstalled } = useWallet();
  const router = useRouter();

  useEffect(() => {
    // Wait until Freighter detection has completed (null = still detecting)
    if (freighterInstalled === null) return;
    // If no address, redirect immediately
    if (!address) {
      router.replace(redirectTo);
    }
  }, [address, freighterInstalled, redirectTo, router]);

  // Still detecting Freighter — show nothing to avoid flash
  if (freighterInstalled === null) {
    return (
      <div
        className="flex items-center justify-center min-h-[40vh]"
        role="status"
        aria-label="Checking wallet connection…"
      >
        <Spinner className="h-6 w-6" label="Checking wallet connection" />
      </div>
    );
  }

  // No address — redirect is in flight, render nothing
  if (!address) return null;

  return <>{children}</>;
}
