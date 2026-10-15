/**
 * Tests for error page templates — #1097
 *
 * Covers:
 * - 404 page: search bar renders and navigates
 * - app/error.tsx: shows error ID, try again, go home
 * - OfflinePage: detects online state, auto-reload on reconnect
 */
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Mocks ────────────────────────────────────────────────────────────────────
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: jest.fn(() => "/some/missing-page"),
}));

jest.mock("next/link", () => {
  const MockLink = ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  );
  MockLink.displayName = "MockLink";
  return MockLink;
});

// ── NotFoundSearch ────────────────────────────────────────────────────────────
import NotFoundSearch from "../app/NotFoundSearch";

describe("NotFoundSearch (#1097)", () => {
  beforeEach(() => mockPush.mockClear());

  it("renders a search input and submit button", () => {
    render(<NotFoundSearch />);
    expect(screen.getByRole("searchbox")).toBeDefined();
    expect(screen.getByRole("button", { name: /submit search/i })).toBeDefined();
  });

  it("has role='search' landmark", () => {
    render(<NotFoundSearch />);
    expect(screen.getByRole("search")).toBeDefined();
  });

  it("navigates to /help/faq with query on submit", async () => {
    render(<NotFoundSearch />);
    const input = screen.getByRole("searchbox");
    await userEvent.type(input, "health factor");
    await userEvent.click(screen.getByRole("button", { name: /submit search/i }));
    expect(mockPush).toHaveBeenCalledWith(
      "/help/faq?q=health%20factor"
    );
  });

  it("does not navigate when query is empty", async () => {
    render(<NotFoundSearch />);
    await userEvent.click(screen.getByRole("button", { name: /submit search/i }));
    expect(mockPush).not.toHaveBeenCalled();
  });
});

// ── not-found.tsx ─────────────────────────────────────────────────────────────
import NotFound from "../app/not-found";

describe("NotFound page with search bar (#1097)", () => {
  it("renders a search bar", () => {
    render(<NotFound />);
    expect(screen.getByRole("searchbox")).toBeDefined();
  });

  it("renders Help & FAQ popular link", () => {
    render(<NotFound />);
    // There may be multiple Help & FAQ links (one in body text, one in nav)
    const links = screen.getAllByRole("link", { name: /help & faq/i });
    expect(links.length).toBeGreaterThanOrEqual(1);
  });
});

// ── app/error.tsx ─────────────────────────────────────────────────────────────
import RouteError from "../app/error";

function makeError(message = "Unexpected failure", digest?: string) {
  const err = new Error(message) as Error & { digest?: string };
  if (digest) err.digest = digest;
  return err;
}

describe("RouteError page (#1097)", () => {
  const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  afterAll(() => consoleSpy.mockRestore());

  it("renders the error heading", () => {
    render(<RouteError error={makeError()} reset={jest.fn()} />);
    expect(screen.getByRole("heading", { name: /something went wrong/i })).toBeDefined();
  });

  it("renders 'Try again' button that calls reset", async () => {
    const reset = jest.fn();
    render(<RouteError error={makeError()} reset={reset} />);
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("renders 'Go home' link pointing to '/'", () => {
    render(<RouteError error={makeError()} reset={jest.fn()} />);
    const link = screen.getByRole("link", { name: /go home/i });
    expect(link.getAttribute("href")).toBe("/");
  });

  it("shows support reference when digest is present", () => {
    render(<RouteError error={makeError("Oops", "ABCDEFGH12345678")} reset={jest.fn()} />);
    expect(screen.getByText(/support reference/i)).toBeDefined();
    // The reference ID is derived from the last 8 chars of digest, uppercased with SK- prefix
    expect(screen.getByText(/SK-/)).toBeDefined();
  });
});

// ── offline page ──────────────────────────────────────────────────────────────
import OfflinePage from "../app/offline/page";

describe("OfflinePage (#1097)", () => {
  const originalOnline = window.navigator.onLine;

  afterEach(() => {
    Object.defineProperty(window.navigator, "onLine", {
      writable: true,
      value: originalOnline,
    });
  });

  it("shows offline message when navigator.onLine is false", () => {
    Object.defineProperty(window.navigator, "onLine", {
      writable: true,
      value: false,
    });
    render(<OfflinePage />);
    expect(screen.getByRole("heading", { name: /you're offline/i })).toBeDefined();
  });

  it("shows auto-reconnect notice", () => {
    Object.defineProperty(window.navigator, "onLine", {
      writable: true,
      value: false,
    });
    render(<OfflinePage />);
    expect(
      screen.getByText(/this page will reload automatically/i)
    ).toBeDefined();
  });

  it("shows 'Back online!' heading when navigator.onLine is true", () => {
    Object.defineProperty(window.navigator, "onLine", {
      writable: true,
      value: true,
    });
    render(<OfflinePage />);
    expect(screen.getByRole("heading", { name: /back online/i })).toBeDefined();
  });

  it("shows 'back online' state after 'online' event fires", () => {
    Object.defineProperty(window.navigator, "onLine", {
      writable: true,
      value: false,
    });
    render(<OfflinePage />);
    expect(screen.getByRole("heading", { name: /you're offline/i })).toBeDefined();

    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.getByRole("heading", { name: /back online/i })).toBeDefined();
  });

  it("renders 'Try again' and 'Go home' buttons/links when offline", () => {
    Object.defineProperty(window.navigator, "onLine", {
      writable: true,
      value: false,
    });
    render(<OfflinePage />);
    expect(screen.getByRole("button", { name: /try again/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /go home/i })).toBeDefined();
  });
});
