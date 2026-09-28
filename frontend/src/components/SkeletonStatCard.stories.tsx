/**
 * Stories for SkeletonStatCard and LoanSummaryCards loading/loaded states.
 * Closes #1205 — skeleton loading states for dashboard stat cards.
 */
import type { Meta, StoryObj } from '@storybook/react';
import LoanSummaryCards from './LoanSummaryCards';
import SkeletonStatCard from './SkeletonStatCard';

// ── SkeletonStatCard stories ──────────────────────────────────────────────────

const skeletonMeta: Meta<typeof SkeletonStatCard> = {
  title: 'Components/Skeletons/SkeletonStatCard',
  component: SkeletonStatCard,
  parameters: {
    docs: {
      description: {
        component:
          'Placeholder for a single dashboard stat card. Used while loan data is loading to prevent CLS.',
      },
    },
  },
};
export default skeletonMeta;

export const Default: StoryObj<typeof SkeletonStatCard> = {
  name: 'Single skeleton stat card',
  render: () => (
    <div
      className="grid grid-cols-2 gap-4 lg:grid-cols-4"
      aria-busy="true"
      aria-label="Loading loan summary"
    >
      <SkeletonStatCard />
      <SkeletonStatCard />
      <SkeletonStatCard />
      <SkeletonStatCard />
    </div>
  ),
};

// ── LoanSummaryCards stories ──────────────────────────────────────────────────

const SAMPLE_SUMMARY = {
  totalPrincipal: 50_000_000,
  outstanding: 35_000_000,
  interestAccrued: 2_500_000,
  activeLoanCount: 3,
};

/** Story: data still loading → renders 4 skeleton placeholders */
export const LoadingState: StoryObj<typeof LoanSummaryCards> = {
  name: 'LoanSummaryCards — loading state',
  render: () => <LoanSummaryCards summary={SAMPLE_SUMMARY} loading={true} />,
  parameters: {
    docs: {
      description: {
        story:
          'While loan data is fetching, `loading=true` renders skeleton placeholders for all four stat cards, preventing layout shift.',
      },
    },
  },
};

/** Story: data loaded → renders animated metric values */
export const LoadedState: StoryObj<typeof LoanSummaryCards> = {
  name: 'LoanSummaryCards — loaded state',
  render: () => <LoanSummaryCards summary={SAMPLE_SUMMARY} loading={false} />,
  parameters: {
    docs: {
      description: {
        story:
          'Once data arrives, `loading=false` replaces skeleton placeholders with real animated metric values.',
      },
    },
  },
};
