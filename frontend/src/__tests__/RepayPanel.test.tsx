import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import RepayPanel from "../components/RepayPanel";
import { ToastProvider, ToastContainer } from "../components/toast";
import ErrorBoundary from "../components/ErrorBoundary";

jest.mock('@stellar/freighter-api', () => ({
  signTransaction: jest.fn(),
}));
jest.mock('../lib/stellarUtils', () => ({
  submitSignedXdr: jest.fn(),
  healthColor: jest.fn(),
  formatStroops: jest.fn((stroops: number) => `${stroops / 1e7} XLM`),
}));

import { signTransaction } from '@stellar/freighter-api';
import { submitSignedXdr } from '../lib/stellarUtils';

const mockSign = signTransaction as jest.Mock;
const mockSubmit = submitSignedXdr as jest.Mock;

/** Typed global fetch accessor for mocking without triggering no-explicit-any */
type GlobalWithFetch = typeof globalThis & { fetch: jest.Mock };

function setGlobalFetch(fn: jest.Mock): void {
  (globalThis as GlobalWithFetch).fetch = fn;
}

function getGlobalFetch(): jest.Mock {
  return (globalThis as GlobalWithFetch).fetch;
}

/** Repayment-preview response stub */
function makePreviewResponse() {
  return {
    ok: true,
    json: async () => ({
      breakdown: {
        principal: 99,
        interest: 0,
        fees: 0,
        remaining_balance: 99,
      },
      fully_repaid: false,
      projected_health_factor_bps: 15000,
    }),
  };
}

/** POST /api/loan/repay success response stub */
function makeRepayResponse() {
  return {
    ok: true,
    json: async () => ({ xdr: 'test-xdr' }),
  };
}

/**
 * Route fetch calls by URL so tests are not brittle to call order.
 * preview   → /api/loan/repayment-preview
 * repay     → /api/loan/repay
 */
function makeFetchRouter(
  options: {
    repayResponse?: ReturnType<typeof makeRepayResponse> | { reject: Error };
  } = {}
): jest.Mock {
  return jest.fn().mockImplementation((url: string) => {
    if (url.includes('repayment-preview')) {
      return Promise.resolve(makePreviewResponse());
    }
    if (url.includes('/repay')) {
      const r = options.repayResponse;
      if (r && 'reject' in r) {
        return Promise.reject(r.reject);
      }
      return Promise.resolve(options.repayResponse ?? makeRepayResponse());
    }
    return Promise.reject(new Error(`Unmocked URL: ${url}`));
  });
}

function renderPanel(props: { initialLoanId?: string; initialAmount?: string } = {}) {
  return render(
    <ToastProvider>
      <RepayPanel walletAddress="GTEST" />
      <ToastContainer />
    </ToastProvider>
  );
}

describe("RepayPanel", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("renders loan ID and amount inputs and repay button", () => {
    renderPanel();
    expect(screen.getByPlaceholderText("Loan ID")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Amount (stroops)")).toBeInTheDocument();
    expect(screen.getByText("Repay")).toBeInTheDocument();
  });

  it("shows loading indicator while server is confirming", async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ xdr: "test-xdr" }),
    });
    mockSign.mockResolvedValue({ signedTxXdr: "signed-xdr" });
    mockSubmit.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 200))
    );

    renderPanel();
    fireEvent.change(screen.getByPlaceholderText("Loan ID"), { target: { value: "1" } });
    fireEvent.change(screen.getByPlaceholderText("Amount (stroops)"), { target: { value: "100" } });
    fireEvent.click(screen.getByText("Repay"));

    expect(await screen.findByText("Processing…")).toBeTruthy();
  });

  it("shows success toast after server confirms", async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ xdr: "test-xdr" }),
    });
    mockSign.mockResolvedValue({ signedTxXdr: "signed-xdr" });
    mockSubmit.mockResolvedValue("tx-hash");

    renderPanel();
    fireEvent.change(screen.getByPlaceholderText("Loan ID"), { target: { value: "1" } });
    fireEvent.change(screen.getByPlaceholderText("Amount (stroops)"), { target: { value: "100" } });
    fireEvent.click(screen.getByText("Repay"));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Repayment submitted successfully!")
    );
  });

  it("shows a connection-failed toast on network error (#532)", async () => {
    (global as any).fetch = jest.fn().mockRejectedValue(new Error("Network error"));

    renderPanel();
    fireEvent.change(screen.getByPlaceholderText("Loan ID"), { target: { value: "1" } });
    fireEvent.change(screen.getByPlaceholderText("Amount (stroops)"), { target: { value: "100" } });
    fireEvent.click(screen.getByText("Repay"));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Connection failed")
    );
  });

  it("shows the API's own message in a warning toast on a 4xx response (#532)", async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "amount exceeds outstanding balance" }),
    });

    renderPanel();
    fireEvent.change(screen.getByPlaceholderText("Loan ID"), { target: { value: "1" } });
    fireEvent.change(screen.getByPlaceholderText("Amount (stroops)"), { target: { value: "100" } });
    fireEvent.click(screen.getByText("Repay"));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("amount exceeds outstanding balance")
    );
  });

  it("shows a generic 'Server error' toast on a 5xx response (#532)", async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "internal boom" }),
    });

    renderPanel();
    fireEvent.change(screen.getByPlaceholderText("Loan ID"), { target: { value: "1" } });
    fireEvent.change(screen.getByPlaceholderText("Amount (stroops)"), { target: { value: "100" } });
    fireEvent.click(screen.getByText("Repay"));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Server error")
    );
  });

  it("clears inputs after successful repayment", async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ xdr: "test-xdr" }),
    });
    mockSign.mockResolvedValue({ signedTxXdr: "signed-xdr" });
    mockSubmit.mockResolvedValue("tx-hash");

    renderPanel();
    const loanIdInput = screen.getByPlaceholderText("Loan ID") as HTMLInputElement;
    const amountInput = screen.getByPlaceholderText("Amount (stroops)") as HTMLInputElement;
    fireEvent.change(loanIdInput, { target: { value: "1" } });
    fireEvent.change(amountInput, { target: { value: "100" } });
    fireEvent.click(screen.getByText("Repay"));

    await waitFor(() => expect(loanIdInput.value).toBe(""));
    expect(amountInput.value).toBe("");
  });

  // ── Outstanding balance display ─────────────────────────────────────────

  it('shows outstanding balance after loan ID is entered', async () => {
    setGlobalFetch(makeFetchRouter());

    render(
      <ToastProvider>
        <RepayPanel walletAddress="GTEST" initialLoanId="1" />
      </ToastProvider>
    );

    await waitFor(() => expect(screen.getByTestId('outstanding-balance')).toBeTruthy());
  });

  it('shows skeleton (aria-hidden shimmer) while balance is loading', () => {
    // Never resolve the preview — keeps loading state permanently
    setGlobalFetch(jest.fn().mockImplementation(() => new Promise(() => {})));

    render(
      <ToastProvider>
        <RepayPanel walletAddress="GTEST" initialLoanId="5" />
      </ToastProvider>
    );

    // aria-hidden skeleton shimmers should be in the document
    const skeletons = document.querySelectorAll('[aria-hidden="true"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });
});

// ── #1204: double-submission prevention ────────────────────────────────────

describe('RepayPanel double-submission prevention (#1204)', () => {
  it('disables the submit button immediately after the first click', async () => {
    // Hold the fetch pending so the button stays disabled
    (global as any).fetch = jest.fn().mockImplementation(
      () => new Promise(() => {})
    );

    renderPanel();
    fireEvent.change(screen.getByPlaceholderText('Loan ID'), { target: { value: '1' } });
    fireEvent.change(screen.getByPlaceholderText('Amount (stroops)'), { target: { value: '100' } });

    const button = screen.getByRole('button', { name: /repay/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText('Processing…')).toBeTruthy();
    });

    // Button must be disabled while the request is in-flight
    expect(button).toBeDisabled();
  });

  it('shows a loading spinner after the first click', async () => {
    (global as any).fetch = jest.fn().mockImplementation(
      () => new Promise(() => {})
    );

    renderPanel();
    fireEvent.change(screen.getByPlaceholderText('Loan ID'), { target: { value: '1' } });
    fireEvent.change(screen.getByPlaceholderText('Amount (stroops)'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: /repay/i }));

    await waitFor(() => {
      // Spinner has role="status" and aria-label
      expect(screen.getByRole('status', { name: /processing/i })).toBeTruthy();
    });
  });

  it('re-enables the button after a network error so the user can retry', async () => {
    (global as any).fetch = jest.fn().mockRejectedValue(new Error('Network error'));

    renderPanel();
    fireEvent.change(screen.getByPlaceholderText('Loan ID'), { target: { value: '1' } });
    fireEvent.change(screen.getByPlaceholderText('Amount (stroops)'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: /repay/i }));

    await waitFor(() => {
      // After error, button must be re-enabled for retry
      expect(screen.getByRole('button', { name: /repay/i })).not.toBeDisabled();
    });
  });

  it('does not submit a second request if clicked again while in-flight', async () => {
    let resolveFirst!: (v: unknown) => void;
    const fetchMock = jest.fn().mockImplementation(() => new Promise((res) => {
      resolveFirst = res;
    }));
    (global as any).fetch = fetchMock;

    renderPanel();
    fireEvent.change(screen.getByPlaceholderText('Loan ID'), { target: { value: '1' } });
    fireEvent.change(screen.getByPlaceholderText('Amount (stroops)'), { target: { value: '100' } });

    const button = screen.getByRole('button', { name: /repay/i });
    fireEvent.click(button);

    // Wait for the button to become disabled
    await waitFor(() => expect(button).toBeDisabled());

    // Try clicking again — should have no effect
    fireEvent.click(button);
    fireEvent.click(button);

    // fetch must still have been called only once
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Settle the promise to avoid act() warnings
    resolveFirst({ ok: true, json: async () => ({ xdr: 'xdr' }) });
  });
});

// #494: Error boundary wrapping
describe('RepayPanel error boundary (#494)', () => {
  function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
    if (shouldThrow) throw new Error('repay panel explosion');
    return <span>OK</span>;
  }

  it('renders the error boundary fallback when a child throws', () => {
    render(
      <ToastProvider>
        <ErrorBoundary section="Repay Loan">
          <Bomb shouldThrow={true} />
        </ErrorBoundary>
      </ToastProvider>
    );
    expect(screen.getByText(/something went wrong/i)).toBeTruthy();
  });

  it('renders children normally when no error occurs', () => {
    render(
      <ToastProvider>
        <ErrorBoundary section="Repay Loan">
          <Bomb shouldThrow={false} />
        </ErrorBoundary>
      </ToastProvider>
    );
    expect(screen.getByText('OK')).toBeTruthy();
  });
});
