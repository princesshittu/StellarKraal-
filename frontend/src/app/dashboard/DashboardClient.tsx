"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { GlossaryTerm } from "@/components/GlossaryTerm";
import CollateralCard from "@/components/CollateralCard";
import SkeletonHealthDashboard from "@/components/SkeletonHealthDashboard";
import SkeletonLoanCard from "@/components/SkeletonLoanCard";
import HelpMenu from "@/components/HelpMenu";
import OnboardingChecklist from "@/components/OnboardingChecklist";
import ErrorBoundary from "@/components/ErrorBoundary";
import { useHealthFactor } from "@/hooks/useHealthFactor";
import { useOnboarding } from "@/hooks/useOnboarding";
import { Hero } from "@/components/Hero";
import { useToast } from "@/components/toast";
import { fetchWithRetry } from "@/lib/fetchWithRetry";
import { useLoans } from "@/hooks/useLoans";
import { useLiquidationWarning } from "@/hooks/useLiquidationWarning";
import LoanPortfolioSummary from "@/components/LoanPortfolioSummary";
import WalletConnect from "@/components/WalletConnect";

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// ── Lazy-loaded heavy components ─────────────────────────────────────────────
// Using next/dynamic with ssr:false prevents hydration mismatches for
// canvas/SVG-heavy components and reduces the initial JS bundle size.
// Skeleton fallbacks maintain layout stability while chunks load.
// Closes #1070

const HealthGauge = dynamic(() => import("@/components/HealthGauge"), {
  ssr: false,
  loading: () => <SkeletonHealthDashboard />,
});

const LoanRepaymentCalculator = dynamic(
  () => import("@/components/LoanRepaymentCalculator"),
  {
    ssr: false,
    loading: () => <SkeletonLoanCard />,
  },
);

const RepayPanel = dynamic(() => import("@/components/RepayPanel"), {
  ssr: false,
  loading: () => <SkeletonLoanCard />,
});

const OnboardingModal = dynamic(() => import("@/components/OnboardingModal"), {
  ssr: false,
});

// ─────────────────────────────────────────────────────────────────────────────

type TabName = "overview" | "loans" | "collateral" | "transactions";
type LoanWithHealth = {
  id: string;
  health_factor?: number | null;
  status?: string;
};

const TABS: { id: TabName; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "loans", label: "Loans" },
  { id: "collateral", label: "Collateral" },
  { id: "transactions", label: "Transactions" },
];

export default function DashboardClient() {
  const router = useRouter();
  const toast = useToast();
  const [wallet, setWallet] = useState<string | null>(null);
  const [loanId, setLoanId] = useState("");
  const [activeTab, setActiveTab] = useState<TabName>("overview");
  const [helpOpen, setHelpOpen] = useState(false);
  const { showOnboarding, openOnboarding, closeOnboarding } = useOnboarding();
  const { healthFactor, loading: isHealthLoading, refresh: refreshHealth, lastUpdatedLabel, hasFetched } = useHealthFactor(loanId);
  
  // Onboarding checklist state
  const [hasCollateral, setHasCollateral] = useState(false);
  const [hasLoan, setHasLoan] = useState(false);

  // Detect if user has collateral
  useEffect(() => {
    if (!wallet) {
      setHasCollateral(false);
      return;
    }
    fetchWithRetry(`${API}/api/collateral?owner=${wallet}`, {
      toast: {
        onRetry: (attempt) => toast.warning(`Retrying… (attempt ${attempt + 1})`),
        onError: (message) => toast.error(message),
      },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((body) => {
        const items = Array.isArray(body?.data) ? body.data : [];
        setHasCollateral(items.length > 0);
      })
      .catch(() => setHasCollateral(false));
  }, [wallet]); // eslint-disable-line react-hooks/exhaustive-deps

  // Detect if user has loan
  useEffect(() => {
    if (!wallet) {
      setHasLoan(false);
      return;
    }
    fetchWithRetry(`${API}/api/loans?borrower=${wallet}`, {
      toast: {
        onRetry: (attempt) => toast.warning(`Retrying… (attempt ${attempt + 1})`),
        onError: (message) => toast.error(message),
      },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((body) => {
        const items = Array.isArray(body?.data) ? body.data : [];
        setHasLoan(items.length > 0);
      })
      .catch(() => setHasLoan(false));
  }, [wallet]); // eslint-disable-line react-hooks/exhaustive-deps

  // Read hash from URL on mount and when it changes
  useEffect(() => {
    const hash = window.location.hash.slice(1).toLowerCase() as TabName;
    if (["overview", "loans", "collateral", "transactions"].includes(hash)) {
      setActiveTab(hash);
    }
  }, []);

  // Update URL hash when active tab changes
  useEffect(() => {
    window.location.hash = `#${activeTab}`;
  }, [activeTab]);

  const handleTabChange = (tabId: TabName) => {
    setActiveTab(tabId);
  };

  const handleTabKeyDown = (e: React.KeyboardEvent, index: number) => {
    let nextIndex = index;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      nextIndex = (index + 1) % TABS.length;
      e.preventDefault();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      nextIndex = (index - 1 + TABS.length) % TABS.length;
      e.preventDefault();
    } else {
      return;
    }
    setActiveTab(TABS[nextIndex].id);
  };

  // Fetch loans to check for at-risk health factors
  const { loans, isLoading: isLoansLoading } = useLoans({ refreshInterval: 60_000 });
  const loansWithHealth = loans as unknown as LoanWithHealth[];

  const { shouldShow: showLiquidationWarning, atRiskLoans, dismiss: dismissWarning } =
    useLiquidationWarning(loansWithHealth);

  function handleProceedToRepay(nextLoanId: string, _nextAmount: string) {
    setLoanId(nextLoanId);
    setActiveTab("loans");
  }

  return (
    <main className="mx-auto max-w-6xl">
      <Hero className="py-10 mb-6">
        <div className="flex items-center justify-between px-4">
          <h1 className="text-3xl font-bold text-brown">Dashboard</h1>
          <HelpMenu
            onShowOnboarding={openOnboarding}
            isOpen={helpOpen}
            onClose={() => setHelpOpen(false)}
          />
        </div>
      </Hero>
      <div className="px-4">
        <OnboardingModal isOpen={showOnboarding} onClose={closeOnboarding} />
        <WalletConnect onConnect={setWallet} />
      </div>
      {wallet && (
        <>
          <LoanPortfolioSummary loans={loans} loading={isLoansLoading} />
          <OnboardingChecklist
            hasWallet={!!wallet}
            hasCollateral={hasCollateral}
            hasLoan={hasLoan}
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <CollateralCard walletAddress={wallet} />
            <LoanRepaymentCalculator
              onProceed={handleProceedToRepay}
              onApplyForLoan={() => router.push("/borrow")}
            />
          </div>
          <div className="mt-4">
            <ErrorBoundary section="Repay Loan" onRetry={() => {}}>
              <RepayPanel walletAddress={wallet} />
            </ErrorBoundary>
          </div>
          <div className="mt-4">
            <TransactionHistory walletAddress={wallet} />
          </div>
          <div className="border-b border-brown/20 mb-6">
            <div className="flex gap-4" role="tablist" aria-label="Dashboard views">
              {TABS.map((tab, index) => (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  aria-controls={`${tab.id}-panel`}
                  id={`${tab.id}-tab`}
                  onClick={() => handleTabChange(tab.id)}
                  onKeyDown={(e) => handleTabKeyDown(e, index)}
                  className={`px-4 py-2 font-medium text-sm transition-colors border-b-2 ${
                    activeTab === tab.id
                      ? "border-brown text-brown"
                      : "border-transparent text-brown/60 hover:text-brown"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tab Content - Overview */}
          {activeTab === "overview" && (
            <div
              role="tabpanel"
              id="overview-panel"
              aria-labelledby="overview-tab"
              className="space-y-4"
            >
              <div className="grid gap-4 lg:grid-cols-2">
                <CollateralCard walletAddress={wallet} />
                <LoanRepaymentCalculator
                  onProceed={handleProceedToRepay}
                  onApplyForLoan={() => router.push("/borrow")}
                />
              </div>
              {isHealthLoading ? (
                <SkeletonHealthDashboard />
              ) : (
                <div className="mt-8 rounded-2xl bg-white p-6 shadow">
                  <h2 className="mb-3 text-xl font-semibold text-brown">
                    <GlossaryTerm termKey="healthFactor" />
                  </h2>
                  <div className="flex items-center gap-2">
                    <input
                      className="flex-1 rounded-lg border border-brown/30 px-3 py-2"
                      placeholder="Loan ID"
                      value={loanId}
                      onChange={(e) => setLoanId(e.target.value)}
                    />
                    <button
                      onClick={refreshHealth}
                      className="rounded-lg bg-gold px-4 py-2 font-semibold text-brown transition hover:bg-gold/80"
                    >
                      Check
                    </button>
                  </div>
                  {healthFactor !== null && <HealthGauge value={healthFactor} />}
                </div>
              )}
            </div>
          )}

          {/* Tab Content - Loans */}
          {activeTab === "loans" && (
            <div
              role="tabpanel"
              id="loans-panel"
              aria-labelledby="loans-tab"
              className="space-y-4"
            >
              <div className="mt-4">
                <RepayPanel walletAddress={wallet} />
              </div>
              {isHealthLoading ? (
                <SkeletonHealthDashboard />
              ) : (
                <div className="mt-8 rounded-2xl bg-white p-6 shadow">
                  <h2 className="mb-3 text-xl font-semibold text-brown">
                    <GlossaryTerm termKey="healthFactor" />
                  </h2>
                  <div className="flex items-center gap-2">
                    <input
                      className="flex-1 rounded-lg border border-brown/30 px-3 py-2"
                      placeholder="Loan ID"
                      value={loanId}
                      onChange={(e) => setLoanId(e.target.value)}
                    />
                    <button
                      onClick={refreshHealth}
                      className="rounded-lg bg-gold px-4 py-2 font-semibold text-brown transition hover:bg-gold/80"
                    >
                      Check
                    </button>
                  </div>
                  {healthFactor !== null && <HealthGauge value={healthFactor} />}
                </div>
              )}
            </div>
          )}

          {/* Tab Content - Collateral */}
          {activeTab === "collateral" && (
            <div
              role="tabpanel"
              id="collateral-panel"
              aria-labelledby="collateral-tab"
            >
              <CollateralCard walletAddress={wallet} />
            </div>
          )}

          {/* Tab Content - Transactions */}
          {activeTab === "transactions" && (
            <div
              role="tabpanel"
              id="transactions-panel"
              aria-labelledby="transactions-tab"
            >
              <div className="mt-4">
                <TransactionHistory walletAddress={wallet} />
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}
