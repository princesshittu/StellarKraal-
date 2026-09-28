/**
 * Tests for SkeletonStatCard and LoanSummaryCards skeleton behaviour.
 * Closes #1205 — skeleton loading states for dashboard stat cards.
 *
 * Covers:
 *  - SkeletonStatCard: renders, aria-hidden, contains shimmer elements
 *  - LoanSummaryCards loading=true: renders skeletons, aria-busy, no real values
 *  - LoanSummaryCards loading=false: renders real metric values, not skeletons
 *  - Skeletons disappear once data is available (transition from loading → loaded)
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import SkeletonStatCard from '../components/SkeletonStatCard';
import LoanSummaryCards from '../components/LoanSummaryCards';

// AnimatedCounter outputs the formatted value synchronously in test environment
jest.mock('../components/AnimatedCounter', () => ({
  __esModule: true,
  default: ({
    value,
    formatter,
    'aria-label': ariaLabel,
    className,
  }: {
    value: number;
    formatter?: (n: number) => string;
    'aria-label': string;
    className?: string;
  }) => (
    <span aria-label={ariaLabel} className={className}>
      {formatter ? formatter(value) : String(value)}
    </span>
  ),
}));

const SAMPLE_SUMMARY = {
  totalPrincipal: 50_000_000,
  outstanding: 35_000_000,
  interestAccrued: 2_500_000,
  activeLoanCount: 3,
};

// ── SkeletonStatCard ──────────────────────────────────────────────────────────

describe('SkeletonStatCard (#1205)', () => {
  it('renders without crashing', () => {
    const { container } = render(<SkeletonStatCard />);
    expect(container.firstChild).toBeTruthy();
  });

  it('is aria-hidden (decorative)', () => {
    const { container } = render(<SkeletonStatCard />);
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('contains skeleton-shimmer elements for the pulse animation', () => {
    const { container } = render(<SkeletonStatCard />);
    const shimmers = container.querySelectorAll('.skeleton-shimmer');
    expect(shimmers.length).toBeGreaterThanOrEqual(2); // label row + value row
  });

  it('accepts an extra className', () => {
    const { container } = render(<SkeletonStatCard className="my-class" />);
    expect((container.firstChild as HTMLElement).className).toContain('my-class');
  });
});

// ── LoanSummaryCards — loading state ─────────────────────────────────────────

describe('LoanSummaryCards loading state (#1205)', () => {
  it('renders skeleton placeholders when loading=true', () => {
    const { container } = render(
      <LoanSummaryCards summary={SAMPLE_SUMMARY} loading={true} />
    );
    const shimmers = container.querySelectorAll('.skeleton-shimmer');
    expect(shimmers.length).toBeGreaterThan(0);
  });

  it('sets aria-busy="true" on the section while loading', () => {
    render(<LoanSummaryCards summary={SAMPLE_SUMMARY} loading={true} />);
    const section = screen.getByRole('region', { name: /loan summary/i });
    expect(section).toHaveAttribute('aria-busy', 'true');
  });

  it('does not render real metric labels while loading', () => {
    render(<LoanSummaryCards summary={SAMPLE_SUMMARY} loading={true} />);
    expect(screen.queryByText('Total Principal')).toBeNull();
    expect(screen.queryByText('Active Loans')).toBeNull();
  });

  it('does not render real metric values while loading', () => {
    render(<LoanSummaryCards summary={SAMPLE_SUMMARY} loading={true} />);
    // activeLoanCount = 3, should not be rendered
    expect(screen.queryByText('3')).toBeNull();
  });
});

// ── LoanSummaryCards — loaded state ──────────────────────────────────────────

describe('LoanSummaryCards loaded state (#1205)', () => {
  it('renders real metric labels when loading=false', () => {
    render(<LoanSummaryCards summary={SAMPLE_SUMMARY} loading={false} />);
    expect(screen.getByText('Total Principal')).toBeTruthy();
    expect(screen.getByText('Outstanding Balance')).toBeTruthy();
    expect(screen.getByText('Interest Accrued')).toBeTruthy();
    expect(screen.getByText('Active Loans')).toBeTruthy();
  });

  it('sets aria-busy="false" when data is loaded', () => {
    render(<LoanSummaryCards summary={SAMPLE_SUMMARY} loading={false} />);
    const section = screen.getByRole('region', { name: /loan summary/i });
    expect(section).toHaveAttribute('aria-busy', 'false');
  });

  it('does not render skeleton shimmers once loaded', () => {
    const { container } = render(
      <LoanSummaryCards summary={SAMPLE_SUMMARY} loading={false} />
    );
    const shimmers = container.querySelectorAll('.skeleton-shimmer');
    expect(shimmers.length).toBe(0);
  });
});

// ── Transition: loading → loaded ─────────────────────────────────────────────

describe('LoanSummaryCards transition loading → loaded (#1205)', () => {
  it('shows skeletons while loading and real data after', () => {
    const { container, rerender } = render(
      <LoanSummaryCards summary={SAMPLE_SUMMARY} loading={true} />
    );

    // While loading: skeletons present
    expect(container.querySelectorAll('.skeleton-shimmer').length).toBeGreaterThan(0);
    expect(screen.queryByText('Total Principal')).toBeNull();

    // After data arrives: skeletons gone, real labels visible
    rerender(<LoanSummaryCards summary={SAMPLE_SUMMARY} loading={false} />);
    expect(container.querySelectorAll('.skeleton-shimmer').length).toBe(0);
    expect(screen.getByText('Total Principal')).toBeTruthy();
  });
});
