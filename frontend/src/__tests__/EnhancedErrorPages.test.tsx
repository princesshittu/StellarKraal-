/**
 * Tests for enhanced error pages — Issue #1255
 *
 * Covers:
 *  - not-found.tsx: improved messaging, URL suggestion, Help & FAQ link
 *  - error.tsx: "Contact support" link present, existing behavior preserved
 */
import React from "react";
import { render, screen } from "@testing-library/react";
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

// ── not-found.tsx tests ───────────────────────────────────────────────────────
import NotFound from "../app/not-found";

describe("NotFound page (#1255)", () => {
  it("renders the 404 heading", () => {
    render(<NotFound />);
    expect(screen.getByRole("heading", { name: /404/i })).toBeTruthy();
  });

  it("renders 'Page not found' sub-heading", () => {
    render(<NotFound />);
    expect(screen.getByRole("heading", { name: /page not found/i })).toBeTruthy();
  });

  it("renders a 'Go home' link to '/'", () => {
    render(<NotFound />);
    const link = screen.getByRole("link", { name: /go home/i });
    expect(link.getAttribute("href")).toBe("/");
  });

  it("renders a 'Dashboard' navigation link", () => {
    render(<NotFound />);
    expect(screen.getByRole("link", { name: /dashboard/i })).toBeTruthy();
  });

  it("renders a 'Help & FAQ' link for guidance", () => {
    render(<NotFound />);
    const links = screen.getAllByRole("link", { name: /help/i });
    // At least one Help link should be present
    expect(links.length).toBeGreaterThanOrEqual(1);
  });

  it("mentions checking the URL in the page body", () => {
    render(<NotFound />);
    expect(screen.getByText(/double-check the url/i)).toBeTruthy();
  });

  it("has a search input for finding pages", () => {
    render(<NotFound />);
    expect(screen.getByRole("searchbox")).toBeTruthy();
  });

  it("nav landmark has accessible label", () => {
    render(<NotFound />);
    expect(
      screen.getByRole("navigation", { name: /suggested pages/i })
    ).toBeTruthy();
  });
});

// ── error.tsx tests ───────────────────────────────────────────────────────────
import RouteError from "../app/error";

const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
afterAll(() => consoleSpy.mockRestore());

function makeError(message = "Unexpected failure", digest?: string) {
  const err = new Error(message) as Error & { digest?: string };
  if (digest) err.digest = digest;
  return err;
}

describe("RouteError (error.tsx) — #1255", () => {
  it("renders the 'Something went wrong' heading", () => {
    render(<RouteError error={makeError()} reset={jest.fn()} />);
    expect(
      screen.getByRole("heading", { name: /something went wrong/i })
    ).toBeTruthy();
  });

  it("renders a 'Try again' button", () => {
    const reset = jest.fn();
    render(<RouteError error={makeError()} reset={reset} />);
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
  });

  it("'Try again' button calls reset", async () => {
    const reset = jest.fn();
    render(<RouteError error={makeError()} reset={reset} />);
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("renders a 'Go home' link to '/'", () => {
    render(<RouteError error={makeError()} reset={jest.fn()} />);
    const link = screen.getByRole("link", { name: /go home/i });
    expect(link.getAttribute("href")).toBe("/");
  });

  it("renders a 'Contact support' link (#1255)", () => {
    render(<RouteError error={makeError()} reset={jest.fn()} />);
    const links = screen.getAllByRole("link", { name: /contact support/i });
    expect(links.length).toBeGreaterThanOrEqual(1);
  });

  it("'Contact support' link points to /help/faq", () => {
    render(<RouteError error={makeError()} reset={jest.fn()} />);
    const link = screen.getAllByRole("link", { name: /contact support/i })[0];
    expect(link.getAttribute("href")).toBe("/help/faq");
  });

  it("shows support reference when digest is present", () => {
    render(
      <RouteError error={makeError("Oops", "ABCDEFGH12345678")} reset={jest.fn()} />
    );
    expect(screen.getByText(/support reference/i)).toBeTruthy();
    expect(screen.getByText(/SK-/)).toBeTruthy();
  });

  it("renders the Error 500 label", () => {
    render(<RouteError error={makeError()} reset={jest.fn()} />);
    expect(screen.getByText(/error 500/i)).toBeTruthy();
  });

  it("renders correctly in dark mode (no crash)", () => {
    document.documentElement.classList.add("dark");
    expect(() =>
      render(<RouteError error={makeError()} reset={jest.fn()} />)
    ).not.toThrow();
    document.documentElement.classList.remove("dark");
  });
});
