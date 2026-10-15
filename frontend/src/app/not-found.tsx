import type { Metadata } from "next";
import Link from "next/link";
import NotFoundPath from "./NotFoundPath";
import NotFoundSearch from "./NotFoundSearch";

export const metadata: Metadata = {
  title: "404 Not Found — StellarKraal",
  description: "The page you requested could not be found on StellarKraal.",
};

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: "⊞" },
  { href: "/borrow", label: "Borrow", icon: "💰" },
  { href: "/collateral", label: "Collateral", icon: "🐄" },
  { href: "/help/faq", label: "Help & FAQ", icon: "❓" },
] as const;

export default function NotFound() {
  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center px-4 text-center">
      {/* Illustration */}
      <div aria-hidden="true" className="mb-8">
        <svg
          width="120"
          height="120"
          viewBox="0 0 120 120"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-label="Lost cow illustration"
        >
          <circle cx="60" cy="60" r="56" fill="#FDF6EC" stroke="#D4A017" strokeWidth="3" />
          <text
            x="50%"
            y="54%"
            dominantBaseline="middle"
            textAnchor="middle"
            fontSize="52"
          >
            🐄
          </text>
        </svg>
      </div>

      <h1 className="text-6xl font-bold text-brown mb-2">404</h1>
      <h2 className="text-2xl font-semibold text-brown mb-3">Page not found</h2>

      {/* Shows the invalid path that was requested */}
      <NotFoundPath />

      <p className="text-brown/60 max-w-sm mb-2">
        Looks like this page wandered off the pasture. Double-check the URL or
        head back to the dashboard to find what you&apos;re looking for.
      </p>

      <p className="text-brown/50 text-sm max-w-sm mb-8">
        If you followed a link inside the app, it may be outdated.{" "}
        <Link
          href="/help/faq"
          className="underline underline-offset-2 hover:text-brown transition focus:outline-none focus:ring-2 focus:ring-gold rounded"
        >
          Visit Help & FAQ
        </Link>{" "}
        for guidance.
      </p>

      {/* Search bar — #1097 */}
      <NotFoundSearch />

      {/* Navigation suggestions */}
      <nav aria-label="Suggested pages" className="flex flex-wrap justify-center gap-3 mt-8">
        <Link
          href="/"
          className="bg-brown text-cream font-semibold px-6 py-3 rounded-xl hover:bg-brown/80 transition focus:outline-none focus:ring-2 focus:ring-gold"
        >
          Go home
        </Link>
        {NAV_LINKS.map(({ href, label, icon }) => (
          <Link
            key={href}
            href={href}
            className="border border-brown/30 text-brown font-semibold px-6 py-3 rounded-xl hover:border-brown/60 transition focus:outline-none focus:ring-2 focus:ring-gold flex items-center gap-2 justify-center"
          >
            <span aria-hidden="true">{icon}</span>
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
