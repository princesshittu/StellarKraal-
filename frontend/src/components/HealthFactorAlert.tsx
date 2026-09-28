'use client';

/**
 * HealthFactorAlert — inline warning/critical banner for the loan detail page.
 *
 * Shown when the health factor drops below threshold:
 *  - Warning:  HF < 1.2  (12,000 bps)
 *  - Critical: HF < 1.0  (10,000 bps) — loan is at immediate liquidation risk
 *
 * The banner is aria-live="assertive" so screen readers announce it as soon as
 * it appears after a poll refresh.
 *
 * Value convention: health factor is passed as a decimal (e.g. 1.15), NOT bps.
 */

interface Props {
  /** Health factor as a decimal (e.g. 1.15 means 115% collateralisation). */
  healthFactor: number;
}

const WARNING_THRESHOLD = 1.2;
const CRITICAL_THRESHOLD = 1.0;

export default function HealthFactorAlert({ healthFactor }: Props) {
  if (healthFactor >= WARNING_THRESHOLD) return null;

  const isCritical = healthFactor < CRITICAL_THRESHOLD;

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      data-testid={isCritical ? 'hf-critical-alert' : 'hf-warning-banner'}
      className={`flex items-start gap-3 rounded-2xl border p-4 ${
        isCritical
          ? 'border-red-400 bg-red-50 text-red-900 dark:border-red-700 dark:bg-red-950/40 dark:text-red-100'
          : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100'
      }`}
    >
      {/* Icon */}
      <span
        aria-hidden="true"
        className={`mt-0.5 flex-shrink-0 text-xl ${isCritical ? 'text-red-500' : 'text-amber-500'}`}
      >
        {isCritical ? '🚨' : '⚠️'}
      </span>

      <div className="min-w-0 flex-1">
        <p className="font-semibold text-sm leading-snug">
          {isCritical
            ? 'Critical: Liquidation Imminent'
            : 'Warning: Health Factor Below Safe Level'}
        </p>
        <p className="mt-1 text-sm opacity-90">
          {isCritical ? (
            <>
              Your health factor is{' '}
              <strong>{healthFactor.toFixed(2)}x</strong> — below 1.0. The loan is eligible for
              liquidation. Repay immediately or add collateral to protect your position.
            </>
          ) : (
            <>
              Your health factor is{' '}
              <strong>{healthFactor.toFixed(2)}x</strong> — below the safe threshold of 1.2x.
              Consider repaying part of the loan or adding collateral to reduce liquidation risk.
            </>
          )}
        </p>
      </div>
    </div>
  );
}
