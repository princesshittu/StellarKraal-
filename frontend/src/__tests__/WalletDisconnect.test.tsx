/**
 * WalletDisconnect.test.tsx — Issue #1208
 *
 * Unit tests covering the wallet disconnect flow:
 *  - disconnectAndClear() clears address state
 *  - disconnectAndClear() removes the stellarkraal_wallet localStorage key
 *  - disconnectAndClear() expires the session JWT cookie
 *  - disconnectAndClear() redirects to /
 */
import React from "react";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => "/dashboard",
}));

jest.mock("@/lib/freighterClient", () => ({
  isConnected: jest.fn().mockResolvedValue(true),
  isAllowed: jest.fn().mockResolvedValue(true),
  getAddress: jest.fn().mockResolvedValue({ address: "GTEST123ADDRESS" }),
  setAllowed: jest.fn().mockResolvedValue(undefined),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * A minimal component that exercises the disconnect flow via WalletContext.
 */
function TestConsumer() {
  const { useWalletContext } = require("@/context/WalletContext");
  const { address, disconnectAndClear } = useWalletContext();
  return (
    <div>
      <span data-testid="address">{address ?? "none"}</span>
      <button onClick={disconnectAndClear} data-testid="disconnect-btn">
        Disconnect
      </button>
    </div>
  );
}

function renderWithProvider(address: string | null = "GTEST123ADDRESS") {
  // Pre-seed localStorage with a wallet address so the hook restores it
  if (address) {
    localStorage.setItem("stellarkraal_wallet", address);
  }

  const { WalletProvider } = require("@/context/WalletContext");
  return render(
    <WalletProvider>
      <TestConsumer />
    </WalletProvider>
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Wallet disconnect — Issue #1208", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    // Reset cookie jar
    document.cookie = "session=fake.jwt.token; path=/; max-age=3600";
  });

  it("clears the wallet address from state on disconnect", async () => {
    renderWithProvider();
    const btn = await screen.findByTestId("disconnect-btn");
    await act(async () => {
      await userEvent.click(btn);
    });
    expect(screen.getByTestId("address").textContent).toBe("none");
  });

  it("removes stellarkraal_wallet from localStorage on disconnect", async () => {
    renderWithProvider();
    const btn = await screen.findByTestId("disconnect-btn");
    await act(async () => {
      await userEvent.click(btn);
    });
    expect(localStorage.getItem("stellarkraal_wallet")).toBeNull();
  });

  it("expires the session cookie on disconnect", async () => {
    renderWithProvider();
    const btn = await screen.findByTestId("disconnect-btn");
    await act(async () => {
      await userEvent.click(btn);
    });
    // After expire the cookie value should be empty or gone
    expect(document.cookie).not.toMatch(/session=fake/);
  });

  it("redirects to / after disconnect", async () => {
    renderWithProvider();
    const btn = await screen.findByTestId("disconnect-btn");
    await act(async () => {
      await userEvent.click(btn);
    });
    expect(mockPush).toHaveBeenCalledWith("/");
  });
});
