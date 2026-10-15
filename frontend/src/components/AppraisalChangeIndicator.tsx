/**
 * AppraisalChangeIndicator — Issue #1257
 *
 * Displays a colour-coded change indicator when collateral is reappraised.
 *
 * - Green ↑ + % when new value is higher than previous
 * - Red ↓ + % when new value is lower than previous
 * - Nothing rendered when no previous appraisal exists
 *
 * Colour-blind safe: the arrow symbol (↑/↓) conveys direction independently
 * of colour, so the indicator is unambiguous for users with colour-vision
 * deficiency.
 *
 * Design tokens:
 *   --token-success  (green) for positive change
 *   --token-danger   (red)   for negative change
 *
 * Accessibility:
 *   A visually hidden `<span>` provides a full text description for screen
 *   readers (e.g. "increased by 12.3%"), so users do not rely on the icon.
 */

export interface AppraisalChangeIndicatorProps {
  /** The new (current) appraised value in any unit (stroops, USD, etc.) */
  currentValue: number;
  /**
   * The previous appraised value in the same unit.
   * When `undefined` or `null` the component renders nothing — this
   * satisfies the acceptance criterion "No indicator shown if no previous
   * appraisal exists".
   */
  previousValue?: number | null;
  /** Additional Tailwind classes forwarded to the wrapper element. */
  className?: string;
}

/**
 * Calculate the percentage change between previous and current value.
 * Returns NaN when previousValue is 0 (undefined division).
 */
function percentChange(current: number, previous: number): number {
  if (previous === 0) return NaN;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export default function AppraisalChangeIndicator({
  currentValue,
  previousValue,
  className = "",
}: AppraisalChangeIndicatorProps) {
  // No previous appraisal → render nothing
  if (previousValue == null) return null;

  const pct = percentChange(currentValue, previousValue);

  // Division by zero or same value with pct === 0 — nothing meaningful to show
  if (!isFinite(pct) || pct === 0) return null;

  const isPositive = pct > 0;
  const absPct = Math.abs(pct).toFixed(1);

  // Arrow symbols communicate direction independent of colour (colour-blind safe)
  const arrow = isPositive ? "↑" : "↓";
  const direction = isPositive ? "increased" : "decreased";

  return (
    <span
      aria-label={`Appraised value ${direction} by ${absPct}%`}
      className={[
        "inline-flex items-center gap-0.5 text-sm font-semibold tabular-nums",
        isPositive
          ? "text-[color:var(--token-success)]"
          : "text-[color:var(--token-danger)]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Arrow + percentage — visible to sighted users */}
      <span aria-hidden="true">
        {arrow} {absPct}%
      </span>

      {/* Screen-reader description — hidden visually */}
      <span className="sr-only">
        {direction} by {absPct}%
      </span>
    </span>
  );
}
