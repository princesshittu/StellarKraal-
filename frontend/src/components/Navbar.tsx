"use client";
import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  ClipboardList,
  Beef,
  Settings,
  Keyboard,
  ArrowLeftRight,
} from "lucide-react";
import { Icon } from "@/components/Icon";
import ThemeToggle from "./ThemeToggle";
import { useWallet } from "@/hooks/useWallet";
import { useAtRiskLoans } from "@/hooks/useAtRiskLoans";
import NotificationBadge from "@/components/NotificationBadge";
import { NotificationBell, NotificationDrawer } from "@/components/NotificationDrawer";
import { useNotifications } from "@/hooks/useNotifications";
import { useShortcutsHelp } from "@/components/KeyboardShortcutsProvider";
// i18n — Issue #1207
import LanguageSwitcher from "@/components/LanguageSwitcher";

const JWT_COOKIE_NAME = "session";

/** Expires the JWT session cookie on disconnect — Issue #1208. */
function clearSessionCookie(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${JWT_COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`;
  document.cookie = `${JWT_COOKIE_NAME}=; path=/; max-age=0; SameSite=Strict`;
}

const NAV_SECTIONS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/loans", label: "Loans", icon: ClipboardList },
  { href: "/collateral", label: "Collateral", icon: Beef },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

/**
 * Active-link indicator styles — closes #781
 *
 * Active state:
 *  - Bottom border (3 px, colour-primary token) acting as an underline pill.
 *  - Bold text in the primary token colour.
 *  - Background pill in primary with 10 % opacity — visible on both light/dark.
 *  - `aria-current="page"` for assistive technology.
 *
 * Design token colours satisfy WCAG AA contrast on the nav background
 * in both light mode (#5D3C15 on #FEFCF8 — ~10.8:1) and dark mode
 * (#F0D9B8 on #2A1B0B — ~10.4:1).
 *
 * Icons — #801: lucide-react replaces all emoji. Each icon is decorative
 * (aria-hidden) because the link label is visible text.
 *
 * Notification badge — #803: a red badge on the Dashboard link when any loan
 * has health factor < 1.2.
 */

export default function Navbar() {
  const [walletDropdownOpen, setWalletDropdownOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const walletDropdownRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const router = useRouter();
  const { address, connect, disconnect } = useWallet();
  const { atRiskCount } = useAtRiskLoans();
  const shortcutsHelp = useShortcutsHelp();
  const {
    notifications,
    unreadCount,
    markRead,
    markAllRead,
    dismiss,
    dismissAll,
  } = useNotifications();

  /** Full auth-clearing disconnect — Issue #1208. */
  function handleDisconnect() {
    disconnect();
    clearSessionCookie();
    router.push("/");
  }

  // Close wallet dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        walletDropdownRef.current &&
        !walletDropdownRef.current.contains(event.target as Node)
      ) {
        setWalletDropdownOpen(false);
      }
    }

    if (walletDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [walletDropdownOpen]);

  const truncatedAddress = address
    ? `${address.slice(0, 4)}…${address.slice(-4)}`
    : null;

  // Suppress unused-var lint warnings for wallet actions used in future UI
  void connect;
  void disconnect;
  void truncatedAddress;

  return (
    <nav
      aria-label="Main navigation"
      className="border-b px-4"
      style={{
        backgroundColor: "var(--color-nav-bg)",
        borderColor: "var(--color-nav-border)",
      }}
    >
      <div className="max-w-5xl mx-auto flex items-center justify-between h-14">
        {/* Brand */}
        <Link
          href="/"
          className="font-bold text-lg flex items-center gap-2 min-h-[44px]"
          style={{ color: "var(--color-text)" }}
        >
          <Icon icon={Beef} size="md" aria-hidden="true" className="text-current" />
          StellarKraal
        </Link>

        {/* Desktop nav */}
        <ul className="hidden md:flex items-center gap-1" role="list">
          {NAV_SECTIONS.map(({ href, label, icon }) => {
            const active =
              pathname === href || pathname.startsWith(href + "/");
            const isDashboard = href === "/dashboard";
            return (
              <li key={href}>
                {/*
                 * Active state (#781):
                 * — bottom border acts as a prominent underline-pill indicator
                 * — uses --token-primary so it automatically flips in dark mode
                 * — text colour also uses the token; background adds a subtle pill
                 */}
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={[
                    "relative flex items-center gap-1.5 px-3 min-h-[44px] rounded-lg transition font-medium",
                    active
                      ? "border-b-[3px] font-bold"
                      : "hover:bg-[color:var(--token-primary)]/5",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={
                    active
                      ? {
                          color: "var(--token-primary)",
                          borderBottomColor: "var(--token-primary)",
                          backgroundColor:
                            "color-mix(in srgb, var(--token-primary) 10%, transparent)",
                          borderRadius: "8px 8px 0 0",
                        }
                      : {
                          color: "var(--token-text-muted)",
                        }
                  }
                >
                  {/* lucide icon — decorative, label is the visible text */}
                  <Icon icon={icon} size="sm" className="text-current" />
                  {label}
                  {/* #803: notification badge on dashboard link */}
                  {isDashboard && atRiskCount > 0 && (
                    <NotificationBadge count={atRiskCount} />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Right side: shortcuts help + notification bell + theme toggle + hamburger */}
        <div className="flex items-center gap-1">
          {/* Keyboard shortcuts trigger — #531 */}
          <button
            onClick={() => shortcutsHelp?.openShortcutsHelp()}
            aria-label="Show keyboard shortcuts"
            title="Keyboard shortcuts (?)"
            className="hidden sm:flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg transition hover:bg-[var(--color-border)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--token-accent)]"
          >
            <Icon icon={Keyboard} size="sm" className="text-[color:var(--color-text-muted)]" />
          </button>

          {/* Language switcher — #1207 */}
          <LanguageSwitcher />

          {/* Notification bell — #1066 */}
          <NotificationBell
            unreadCount={unreadCount}
            onClick={() => setNotifOpen((v) => !v)}
            isOpen={notifOpen}
          />

          {/* Notification drawer — #1066 */}
          <NotificationDrawer
            open={notifOpen}
            onClose={() => setNotifOpen(false)}
            notifications={notifications}
            unreadCount={unreadCount}
            onMarkRead={markRead}
            onMarkAllRead={markAllRead}
            onDismiss={dismiss}
            onDismissAll={dismissAll}
          />

          {/* Theme toggle — visible on all screen sizes */}
          <ThemeToggle />
        </div>
      </div>
    </nav>
  );
}
