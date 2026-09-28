/**
 * SkeletonStatCard — skeleton placeholder for a single dashboard stat card.
 *
 * Matches the final layout of a LoanSummaryCards metric card so there is no
 * Cumulative Layout Shift (CLS) when real data arrives.
 *
 * The element is `aria-hidden` — the parent container is expected to carry
 * `aria-busy="true"` and a meaningful `aria-label`.
 *
 * Closes #1205.
 */
import Skeleton from '@/components/Skeleton';

interface SkeletonStatCardProps {
  /** Additional Tailwind classes forwarded to the card wrapper. */
  className?: string;
}

export default function SkeletonStatCard({ className = '' }: SkeletonStatCardProps) {
  return (
    <div
      className={`rounded-2xl bg-white dark:bg-brown-900 p-6 shadow space-y-3 ${className}`.trim()}
      aria-hidden="true"
    >
      {/* Label row — matches the "text-xs uppercase" label in the real card */}
      <Skeleton variant="text" className="h-3 w-24" />
      {/* Value row — matches the "text-2xl font-bold" AnimatedCounter */}
      <Skeleton variant="heading" className="h-7 w-20" />
    </div>
  );
}
