"use client";
import { useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import FocusTrap from "focus-trap-react";
import { Bell, X, CheckCheck, Trash2, AlertTriangle, CheckCircle, XCircle, TrendingDown, type LucideIcon } from "lucide-react";
import { Icon } from "@/components/Icon";
import { motion, AnimatePresence } from "framer-motion";
import type { LoanNotification, LoanNotificationEvent } from "@/hooks/useNotifications";

// ─── Event icon mapping ───────────────────────────────────────────────────────

type IconDef = { icon: LucideIcon; className: string };

const EVENT_ICONS: Record<LoanNotificationEvent, IconDef> = {
  loan_approved:   { icon: CheckCircle,   className: "text-[color:var(--token-success)]" },
  loan_at_risk:    { icon: AlertTriangle, className: "text-[color:var(--token-warning)]" },
  loan_liquidated: { icon: XCircle,       className: "text-[color:var(--token-danger)]" },
  loan_repaid:     { icon: TrendingDown,  className: "text-[color:var(--token-accent)]" },
};

// ─── Notification item ────────────────────────────────────────────────────────

interface NotificationItemProps {
  notification: LoanNotification;
  onRead: (id: string) => void;
  onDismiss: (id: string) => void;
  /** Called when user clicks an item to navigate to its loan. */
  onNavigate: (loanId: string) => void;
}

function NotificationItem({ notification: n, onRead, onDismiss, onNavigate }: NotificationItemProps) {
  const { icon, className } = EVENT_ICONS[n.event] ?? EVENT_ICONS.loan_approved;
  const date = new Date(n.timestamp);
  const timeLabel = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateLabel = date.toLocaleDateString([], { month: "short", day: "numeric" });

  function handleClick() {
    onRead(n.id);
    if (n.loanId) {
      onNavigate(n.loanId);
    }
  }

  return (
    <motion.li
      layout
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      className={[
        "group flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer",
        n.read
          ? "border-[color:var(--token-border)] bg-transparent"
          : "border-[color:var(--token-accent)]/30 bg-[color:var(--token-warning-subtle)] dark:bg-brown-800",
      ].join(" ")}
      onClick={handleClick}
      role="article"
      aria-label={`${n.read ? "Read" : "Unread"}: ${n.message}${n.loanId ? ` — click to view loan ${n.loanId}` : ""}`}
    >
      {/* Event icon */}
      <span className={`mt-0.5 flex-shrink-0 ${className}`}>
        <Icon icon={icon} size="sm" aria-hidden="true" className={className} />
      </span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p
          className={[
            "text-sm leading-snug",
            n.read
              ? "text-[color:var(--token-text-muted)]"
              : "font-medium text-[color:var(--token-text)]",
          ].join(" ")}
        >
          {n.message}
        </p>
        <p className="mt-1 text-xs text-[color:var(--token-text-muted)]">
          {dateLabel} · {timeLabel}
        </p>
        {!n.read && (
          <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-[color:var(--token-accent)]" />
        )}
      </div>

      {/* Dismiss button */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(n.id);
        }}
        aria-label={`Dismiss notification: ${n.message}`}
        className={[
          "flex-shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity",
          "rounded p-0.5 text-[color:var(--token-text-muted)] hover:text-[color:var(--token-danger)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--token-accent)]",
        ].join(" ")}
      >
        <Icon icon={X} size="sm" aria-hidden="true" className="text-current" />
      </button>
    </motion.li>
  );
}

// ─── Notification drawer ──────────────────────────────────────────────────────

interface NotificationDrawerProps {
  /** Whether the drawer is open. */
  open: boolean;
  /** Call to close the drawer. */
  onClose: () => void;
  notifications: LoanNotification[];
  unreadCount: number;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onDismiss: (id: string) => void;
  onDismissAll: () => void;
}

export function NotificationDrawer({
  open,
  onClose,
  notifications,
  unreadCount,
  onMarkRead,
  onMarkAllRead,
  onDismiss,
  onDismissAll,
}: NotificationDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Issue #1210: mark all as read when drawer is opened
  useEffect(() => {
    if (open && unreadCount > 0) {
      onMarkAllRead();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  // Issue #1210: navigate to the relevant loan on notification click
  const handleNavigate = useCallback(
    (loanId: string) => {
      onClose();
      router.push(`/loans/${loanId}`);
    },
    [onClose, router],
  );

  // Issue #1210: show only the last 20 notifications
  const visibleNotifications = notifications.slice(0, 20);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/30"
            aria-hidden="true"
            onClick={onClose}
          />

          {/* Drawer panel */}
          <FocusTrap
            active={open}
            focusTrapOptions={{
              onDeactivate: onClose,
              clickOutsideDeactivates: true,
              escapeDeactivates: true,
              fallbackFocus: "#notification-panel",
            }}
          >
            <motion.div
              key="drawer"
              ref={panelRef}
              id="notification-panel"
              role="dialog"
              aria-modal="true"
              aria-label="Notifications"
              tabIndex={-1}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className={[
                "fixed top-14 right-4 z-50",
                "w-80 sm:w-96 max-h-[calc(100vh-5rem)]",
                "flex flex-col rounded-xl shadow-2xl border",
                "bg-[color:var(--token-surface-raised)] border-[color:var(--token-border)]",
              ].join(" ")}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-[color:var(--token-border)]">
                <h2 className="text-base font-semibold text-[color:var(--token-text)]">
                  Notifications
                  {unreadCount > 0 && (
                    <span
                      aria-label={`${unreadCount} unread`}
                      className="ml-2 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1
                                 rounded-full text-[11px] font-bold
                                 bg-[color:var(--token-danger)] text-white"
                    >
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </h2>
                <div className="flex items-center gap-1">
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={onMarkAllRead}
                      aria-label="Mark all notifications as read"
                      title="Mark all as read"
                      className="flex items-center justify-center rounded p-1 text-[color:var(--token-text-muted)]
                                 hover:text-[color:var(--token-text)] hover:bg-[color:var(--token-border)]
                                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--token-accent)]
                                 transition-colors"
                    >
                      <Icon icon={CheckCheck} size="sm" aria-hidden="true" className="text-current" />
                    </button>
                  )}
                  {notifications.length > 0 && (
                    <button
                      type="button"
                      onClick={onDismissAll}
                      aria-label="Dismiss all notifications"
                      title="Clear all"
                      className="flex items-center justify-center rounded p-1 text-[color:var(--token-text-muted)]
                                 hover:text-[color:var(--token-danger)] hover:bg-[color:var(--token-danger-subtle)]
                                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--token-accent)]
                                 transition-colors"
                    >
                      <Icon icon={Trash2} size="sm" aria-hidden="true" className="text-current" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close notifications"
                    className="flex items-center justify-center rounded p-1 text-[color:var(--token-text-muted)]
                               hover:text-[color:var(--token-text)] hover:bg-[color:var(--token-border)]
                               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--token-accent)]
                               transition-colors"
                  >
                    <Icon icon={X} size="sm" aria-hidden="true" className="text-current" />
                  </button>
                </div>
              </div>

              {/* Notification list */}
              <div className="flex-1 overflow-y-auto px-3 py-2">
                {notifications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
                    <Bell
                      size={32}
                      className="text-[color:var(--token-text-muted)] opacity-40"
                      aria-hidden="true"
                    />
                    <p className="text-sm text-[color:var(--token-text-muted)]">
                      You're all caught up! No notifications yet.
                    </p>
                  </div>
                ) : (
                  <ul className="flex flex-col gap-2" role="list" aria-label="Notification items">
                    <AnimatePresence initial={false}>
                      {visibleNotifications.map((n) => (
                        <NotificationItem
                          key={n.id}
                          notification={n}
                          onRead={onMarkRead}
                          onDismiss={onDismiss}
                          onNavigate={handleNavigate}
                        />
                      ))}
                    </AnimatePresence>
                  </ul>
                )}
              </div>
            </motion.div>
          </FocusTrap>
        </>
      )}
    </AnimatePresence>
  );
}

// ─── Bell button (used in Navbar) ─────────────────────────────────────────────

interface NotificationBellProps {
  unreadCount: number;
  onClick: () => void;
  isOpen: boolean;
}

export function NotificationBell({ unreadCount, onClick, isOpen }: NotificationBellProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={
        unreadCount > 0
          ? `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}. Open notifications`
          : "Open notifications"
      }
      aria-expanded={isOpen}
      aria-haspopup="dialog"
      title="Notifications"
      className={[
        "relative flex items-center justify-center min-h-[44px] min-w-[44px]",
        "rounded-lg transition-colors",
        "hover:bg-[var(--color-border)] focus-visible:outline-none",
        "focus-visible:ring-2 focus-visible:ring-[color:var(--token-accent)]",
        isOpen ? "bg-[var(--color-border)]" : "",
      ].join(" ")}
    >
      <Bell
        size={20}
        className="text-[color:var(--color-text-muted)]"
        aria-hidden="true"
      />
      {unreadCount > 0 && (
        <span
          aria-hidden="true"
          className={[
            "absolute top-1.5 right-1.5",
            "inline-flex items-center justify-center",
            "min-w-[1rem] h-[1rem] px-0.5",
            "rounded-full text-[9px] font-bold leading-none",
            "bg-[color:var(--token-danger,#DC2626)] text-white",
            "ring-1 ring-white/50 dark:ring-stone-800/70",
          ].join(" ")}
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </button>
  );
}
