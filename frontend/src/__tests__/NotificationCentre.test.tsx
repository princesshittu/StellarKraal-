/**
 * NotificationCentre.test.tsx — Issue #1210
 *
 * Tests for the notification centre:
 *  - Bell icon shows unread count badge
 *  - Dropdown lists last 20 notifications with timestamps
 *  - Clicking a notification navigates to the relevant loan
 *  - Notifications are marked as read when the drawer opens
 *  - Data sourced from GET /api/v1/notifications
 */
import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationBell, NotificationDrawer } from "@/components/NotificationDrawer";
import type { LoanNotification } from "@/hooks/useNotifications";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => "/dashboard",
}));

jest.mock("focus-trap-react", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
    li: ({ children, ...props }: React.HTMLAttributes<HTMLLIElement>) => (
      <li {...props}>{children}</li>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeNotification(
  id: string,
  loanId: string,
  read = false
): LoanNotification {
  return {
    id,
    event: "loan_at_risk",
    loanId,
    message: `Loan #${loanId} is at risk`,
    timestamp: Date.now() - 1000 * 60,
    read,
  };
}

function makeNotifications(count: number, read = false): LoanNotification[] {
  return Array.from({ length: count }, (_, i) =>
    makeNotification(`notif-${i}`, `loan-${i}`, read)
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Notification bell — Issue #1210", () => {
  it("shows the unread count badge when there are unread notifications", () => {
    render(
      <NotificationBell unreadCount={5} onClick={() => {}} isOpen={false} />
    );
    // Badge is aria-hidden but visible
    const badge = document.querySelector('[aria-hidden="true"]');
    expect(badge).toHaveTextContent("5");
  });

  it("shows 99+ when unread count exceeds 99", () => {
    render(
      <NotificationBell unreadCount={100} onClick={() => {}} isOpen={false} />
    );
    const badge = document.querySelector('[aria-hidden="true"]');
    expect(badge).toHaveTextContent("99+");
  });

  it("does not render a badge when unread count is 0", () => {
    const { container } = render(
      <NotificationBell unreadCount={0} onClick={() => {}} isOpen={false} />
    );
    // No badge span
    const spans = container.querySelectorAll("span[aria-hidden]");
    expect(spans).toHaveLength(0);
  });

  it("calls onClick when bell button is clicked", async () => {
    const onClick = jest.fn();
    render(<NotificationBell unreadCount={3} onClick={onClick} isOpen={false} />);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("NotificationDrawer — Issue #1210", () => {
  const defaultProps = {
    open: true,
    onClose: jest.fn(),
    notifications: makeNotifications(3),
    unreadCount: 3,
    onMarkRead: jest.fn(),
    onMarkAllRead: jest.fn(),
    onDismiss: jest.fn(),
    onDismissAll: jest.fn(),
  };

  beforeEach(() => jest.clearAllMocks());

  it("renders with a notifications heading", () => {
    render(<NotificationDrawer {...defaultProps} />);
    expect(screen.getByRole("heading", { name: /notifications/i })).toBeInTheDocument();
  });

  it("shows notification messages in the list", () => {
    render(<NotificationDrawer {...defaultProps} />);
    expect(screen.getByText(/Loan #loan-0 is at risk/i)).toBeInTheDocument();
    expect(screen.getByText(/Loan #loan-1 is at risk/i)).toBeInTheDocument();
  });

  it("caps the displayed list at 20 notifications", () => {
    render(
      <NotificationDrawer
        {...defaultProps}
        notifications={makeNotifications(25)}
        unreadCount={25}
      />
    );
    const items = screen.getAllByRole("article");
    expect(items.length).toBe(20);
  });

  it("calls onMarkAllRead when the drawer is opened", () => {
    render(<NotificationDrawer {...defaultProps} />);
    expect(defaultProps.onMarkAllRead).toHaveBeenCalledTimes(1);
  });

  it("does not call onMarkAllRead when unreadCount is 0", () => {
    render(
      <NotificationDrawer
        {...defaultProps}
        notifications={makeNotifications(3, true)}
        unreadCount={0}
      />
    );
    expect(defaultProps.onMarkAllRead).not.toHaveBeenCalled();
  });

  it("navigates to the loan page when a notification is clicked", async () => {
    render(<NotificationDrawer {...defaultProps} />);
    const firstItem = screen.getAllByRole("article")[0];
    await act(async () => {
      await userEvent.click(firstItem);
    });
    expect(mockPush).toHaveBeenCalledWith("/loans/loan-0");
  });

  it("closes the drawer after navigating", async () => {
    render(<NotificationDrawer {...defaultProps} />);
    const firstItem = screen.getAllByRole("article")[0];
    await act(async () => {
      await userEvent.click(firstItem);
    });
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("shows empty state when there are no notifications", () => {
    render(
      <NotificationDrawer
        {...defaultProps}
        notifications={[]}
        unreadCount={0}
      />
    );
    expect(screen.getByText(/you're all caught up/i)).toBeInTheDocument();
  });

  it("shows timestamps on each notification item", () => {
    render(<NotificationDrawer {...defaultProps} />);
    // Each item should have a date + time label (e.g. "Jan 1 · 12:00 AM")
    const timeElements = document.querySelectorAll("p.text-xs");
    expect(timeElements.length).toBeGreaterThan(0);
  });

  it("calls onDismiss when the dismiss button is clicked", async () => {
    render(<NotificationDrawer {...defaultProps} />);
    // Hover to reveal dismiss button (opacity-0 group-hover:opacity-100)
    const dismissButtons = screen.getAllByRole("button", { name: /dismiss notification/i });
    await act(async () => {
      await userEvent.click(dismissButtons[0]);
    });
    expect(defaultProps.onDismiss).toHaveBeenCalledWith("notif-0");
  });

  it("renders nothing when open is false", () => {
    const { container } = render(
      <NotificationDrawer {...defaultProps} open={false} />
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
