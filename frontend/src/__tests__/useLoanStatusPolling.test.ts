/**
 * Unit tests for useLoanStatusPolling (issue #1535).
 *
 * Verifies:
 *  - Hook reads NEXT_PUBLIC_LOAN_POLL_INTERVAL_MS from env
 *  - Falls back to 15 000 ms when the env variable is not set
 *  - Setting the variable to "0" disables polling (pollIntervalMs === 0)
 *  - overrideIntervalMs takes precedence over the env variable
 */

// useLoanStatusPolling delegates to useLoans which uses SWR.
// We mock useLoans to isolate the hook's own logic.
jest.mock("@/hooks/useLoans", () => ({
  useLoans: jest.fn((opts: { refreshInterval?: number } = {}) => ({
    loans: [],
    isLoading: false,
    error: null,
    refresh: jest.fn(),
    _passedRefreshInterval: opts.refreshInterval,
  })),
}));

import { useLoanStatusPolling } from "../hooks/useLoanStatusPolling";
import { useLoans } from "../hooks/useLoans";
import { renderHook } from "@testing-library/react";

const mockUseLoans = useLoans as jest.MockedFunction<typeof useLoans>;

describe("useLoanStatusPolling", () => {
  const originalEnv = process.env.NEXT_PUBLIC_LOAN_POLL_INTERVAL_MS;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.NEXT_PUBLIC_LOAN_POLL_INTERVAL_MS;
    } else {
      process.env.NEXT_PUBLIC_LOAN_POLL_INTERVAL_MS = originalEnv;
    }
    jest.clearAllMocks();
  });

  it("uses 15 000 ms default when env var is not set", () => {
    delete process.env.NEXT_PUBLIC_LOAN_POLL_INTERVAL_MS;

    const { result } = renderHook(() => useLoanStatusPolling());

    expect(result.current.pollIntervalMs).toBe(15_000);
    expect(mockUseLoans).toHaveBeenCalledWith({ refreshInterval: 15_000 });
  });

  it("reads the interval from NEXT_PUBLIC_LOAN_POLL_INTERVAL_MS", () => {
    process.env.NEXT_PUBLIC_LOAN_POLL_INTERVAL_MS = "30000";

    const { result } = renderHook(() => useLoanStatusPolling());

    expect(result.current.pollIntervalMs).toBe(30_000);
    expect(mockUseLoans).toHaveBeenCalledWith({ refreshInterval: 30_000 });
  });

  it("disables polling when env var is '0'", () => {
    process.env.NEXT_PUBLIC_LOAN_POLL_INTERVAL_MS = "0";

    const { result } = renderHook(() => useLoanStatusPolling());

    expect(result.current.pollIntervalMs).toBe(0);
    expect(mockUseLoans).toHaveBeenCalledWith({ refreshInterval: 0 });
  });

  it("overrideIntervalMs takes precedence over env var", () => {
    process.env.NEXT_PUBLIC_LOAN_POLL_INTERVAL_MS = "60000";

    const { result } = renderHook(() => useLoanStatusPolling(5_000));

    expect(result.current.pollIntervalMs).toBe(5_000);
    expect(mockUseLoans).toHaveBeenCalledWith({ refreshInterval: 5_000 });
  });

  it("exposes loans, isLoading, error, and refresh from useLoans", () => {
    delete process.env.NEXT_PUBLIC_LOAN_POLL_INTERVAL_MS;

    const { result } = renderHook(() => useLoanStatusPolling());

    expect(result.current.loans).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(typeof result.current.refresh).toBe("function");
  });
});
