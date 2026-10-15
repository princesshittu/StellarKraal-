"use client";

import { useEffect } from "react";
import Link from "next/link";

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Route-level error boundary — #1097 / #1255
 *
 * Shown when a server component in a route segment throws.
 * Unlike global-error.tsx (which wraps the root layout), this component
 * has access to the full layout so Navbar and shell remain visible.
 *
 * Shows:
 *   - Friendly copy
 *   - Error ID (digest) for support reference in production
 *   - "Try again" button that calls reset()
 *   - "Go home" link
 *   - "Contact support" link (#1255)
 */
export default function RouteError({ error, reset }: Props) {
  const referenceId = error.digest
    ? `SK-${error.digest.slice(-8).toUpperCase()}`
    : undefined;

  useEffect(() => {
    if (process.env.NODE_ENV === "production") {
      console.error("[RouteError]", error, { referenceId });
    }
  }, [error, referenceId]);

  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center px-4 text-center">
      {/* Illustration */}
      <div aria-hidden="true" className="mb-8">
        <svg
          width="120"
          height="120"
          viewBox="0 0 120 120"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="60" cy="60" r="56" fill="#FEF2F2" stroke="#DC2626" strokeWidth="3" />
          <text
            x="50%"
            y="54%"
            dominantBaseline="middle"
            textAnchor="middle"
            fontSize="52"
          >
            ⚠️
          </text>
        </svg>
      </div>

      <p className="text-sm font-semibold uppercase tracking-widest text-red-500 mb-3">
        Error 500
      </p>

      <h1
        id="route-error-title"
        className="text-3xl font-bold text-brown mb-3"
      >
        Something went wrong
      </h1>

      <p
        id="route-error-description"
        className="text-brown/60 max-w-md mb-6"
      >
        An unexpected error occurred on this page. You can try again or return
        home. If the problem persists, please{" "}
        <Link
          href="/help/faq"
          className="underline underline-offset-2 font-medium text-brown/80 hover:text-brown transition focus:outline-none focus:ring-2 focus:ring-gold rounded"
        >
          contact support
        </Link>
        {referenceId && (
          <> and share the reference ID below</>
        )}
        .
      </p>

      {/* Support reference ID — shown in production */}
      {referenceId && (
        <div
          aria-label="Support reference"
          className="mb-6 rounded-lg border border-brown/20 bg-brown/5 px-5 py-4 text-left w-full max-w-sm"
        >
          <p className="text-xs font-medium uppercase tracking-widest text-brown/50 mb-1">
            Support reference
          </p>
          <p className="font-mono text-sm text-brown">{referenceId}</p>
        </div>
      )}

      {/* Dev-only: show error message */}
      {process.env.NODE_ENV !== "production" && (
        <div
          aria-label="Development error details"
          className="mb-6 rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-left w-full max-w-sm"
        >
          <p className="text-xs font-medium uppercase tracking-widest text-red-400 mb-1">
            Error
          </p>
          <p className="font-mono text-sm text-red-700 break-words">{error.message}</p>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={reset}
          className="bg-brown text-cream font-semibold px-6 py-3 rounded-xl hover:bg-brown/80
            transition focus:outline-none focus:ring-2 focus:ring-gold"
          type="button"
        >
          Try again
        </button>
        <Link
          href="/"
          className="border border-brown/30 text-brown font-semibold px-6 py-3 rounded-xl
            hover:border-brown/60 transition focus:outline-none focus:ring-2 focus:ring-gold"
        >
          Go home
        </Link>
        <Link
          href="/help/faq"
          className="border border-brown/30 text-brown font-semibold px-6 py-3 rounded-xl
            hover:border-brown/60 transition focus:outline-none focus:ring-2 focus:ring-gold"
        >
          Contact support
        </Link>
      </div>
    </div>
  );
}
