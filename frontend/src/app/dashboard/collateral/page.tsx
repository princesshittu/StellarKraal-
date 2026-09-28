'use client';
import { useState, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import WalletConnect from '@/components/WalletConnect';
import CollateralSummary from '@/components/CollateralSummary';
import CollateralGrid from '@/components/CollateralGrid';
import ErrorState from '@/components/ErrorState';
import Pagination from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';
import { useOwnerCollateral } from '@/hooks/useCollateral';
import { Button } from '@/components/ui';

function CollateralContent() {
  const router = useRouter();
  const [wallet, setWallet] = useState<string | null>(null);
  const {
    collaterals,
    isLoading: loading,
    error,
    refresh: fetchCollaterals,
  } = useOwnerCollateral(wallet);

  function handleCardClick(collateralId: string) {
    router.push(`/dashboard/collateral/${collateralId}`);
  }

  const { page, limit, totalPages, setPage, setLimit, slice } = usePagination(collaterals.length);
  const paginated = slice(collaterals);

  return (
    <main className="max-w-6xl mx-auto px-4 py-10">
      <h1 className="text-2xl sm:text-3xl font-bold text-brown mb-6">My Collateral</h1>
      <WalletConnect onConnect={setWallet} />

      {wallet && (
        <>
          {error ? (
            <ErrorState message={error} onRetry={fetchCollaterals} />
          ) : loading ? (
            <CollateralGrid collaterals={[]} loading={true} onCardClick={handleCardClick} />
          ) : collaterals.length > 0 ? (
            <>
              <CollateralSummary collaterals={collaterals} />
              <CollateralGrid
                collaterals={paginated}
                loading={false}
                onCardClick={handleCardClick}
              />
              <Pagination
                page={page}
                totalPages={totalPages}
                limit={limit}
                onPageChange={setPage}
                onLimitChange={setLimit}
              />
            </>
          ) : (
            <div className="bg-white rounded-2xl p-8 sm:p-12 shadow text-center">
              <h2 className="text-2xl font-semibold text-brown-700 mb-3">
                No Collateral Registered
              </h2>
              <p className="text-brown-400 mb-6">
                Register livestock as collateral to start borrowing
              </p>
              <Button onClick={() => router.push('/borrow')}>Register Collateral</Button>
            </div>
          )}
        </>
      )}
    </main>
  );
}

export default function CollateralPage() {
  return (
    <Suspense fallback={<main className="max-w-6xl mx-auto px-4 py-10"><div className="text-brown/60">Loading collateral...</div></main>}>
      <CollateralContent />
    </Suspense>
  );
}

