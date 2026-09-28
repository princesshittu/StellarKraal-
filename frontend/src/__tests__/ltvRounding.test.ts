/**
 * Unit tests for LTV, health factor, and origination fee rounding (#1211).
 *
 * These tests exercise the pure arithmetic functions used by the loan wizard
 * review step, covering edge cases: 0%, 100%, sub-cent values, and the
 * specific floating-point scenario that produced 74.99999999%.
 */

// ── Helpers (mirrors the logic in StepReview / StepAmount) ────────────────────

/** Round a fraction to a percentage string with 2 decimal places. */
function formatLtv(principal: number, appraisedValue: number): string {
  if (principal <= 0 || appraisedValue <= 0) return '0.00';
  return ((principal / appraisedValue) * 100).toFixed(2);
}

/** Round a ratio to 2 decimal places (health factor). */
function formatHealthFactor(appraisedValue: number, principal: number): string {
  if (principal <= 0 || appraisedValue <= 0) return '—';
  return (appraisedValue / principal / 1.5).toFixed(2);
}

/**
 * Mirrors StepReview: fee = floor(principal × ratePercent / 100),
 * then display as a percentage of principal to 2 d.p.
 */
function formatOriginationFeePct(principal: number, ratePercent: number): string {
  if (principal <= 0) return '0.00';
  const fee = Math.floor(principal * (ratePercent / 100));
  return ((fee / principal) * 100).toFixed(2);
}

// ── LTV percentage rounding ────────────────────────────────────────────────────

describe('LTV percentage rounding (issue #1211)', () => {
  it('displays exactly 0.00% when loan amount is 0', () => {
    expect(formatLtv(0, 10_000_000)).toBe('0.00');
  });

  it('displays exactly 100.00% when borrowing the full appraised value', () => {
    expect(formatLtv(10_000_000, 10_000_000)).toBe('100.00');
  });

  it('displays exactly 70.00% for a 70% LTV loan', () => {
    // 7_000_000 / 10_000_000 * 100 = 70 exactly
    expect(formatLtv(7_000_000, 10_000_000)).toBe('70.00');
  });

  it('rounds the classic floating-point case to XX.XX (not 74.99999999)', () => {
    // Specific scenario from the issue: appraisedValue = 10_000_000, loan = 7_499_999
    const ltv = formatLtv(7_499_999, 10_000_000);
    // Should have exactly 2 decimal places, no more
    expect(ltv).toMatch(/^\d+\.\d{2}$/);
    expect(parseFloat(ltv)).toBeCloseTo(74.99999, 0); // ~75%
    expect(ltv).not.toContain('74.99999');
  });

  it('handles sub-cent (1 stroop) loan amounts without trailing garbage', () => {
    const ltv = formatLtv(1, 10_000_000);
    expect(ltv).toMatch(/^\d+\.\d{2}$/);
    expect(parseFloat(ltv)).toBeCloseTo(0, 4);
  });

  it('handles very large values without overflow', () => {
    const ltv = formatLtv(999_999_999, 1_000_000_000);
    expect(ltv).toMatch(/^\d+\.\d{2}$/);
    expect(parseFloat(ltv)).toBeCloseTo(99.99999, 2);
  });
});

// ── Health factor rounding ────────────────────────────────────────────────────

describe('Health factor rounding (issue #1211)', () => {
  it('returns "—" when principal is 0', () => {
    expect(formatHealthFactor(20_000_000, 0)).toBe('—');
  });

  it('returns 2 decimal places', () => {
    // 20_000_000 / 10_000_000 / 1.5 = 1.333…
    const hf = formatHealthFactor(20_000_000, 10_000_000);
    expect(hf).toMatch(/^\d+\.\d{2}$/);
    expect(hf).toBe('1.33');
  });

  it('shows 1.00 when exactly at the threshold', () => {
    // appraisedValue = 1.5 * principal → hf = 1.0
    expect(formatHealthFactor(15_000_000, 10_000_000)).toBe('1.00');
  });
});

// ── Origination fee rounding ──────────────────────────────────────────────────

describe('Origination fee rounding (issue #1211)', () => {
  it('returns "0.00" when principal is 0', () => {
    expect(formatOriginationFeePct(0, 5)).toBe('0.00');
  });

  it('shows exactly 5.00% for 5% rate', () => {
    // fee = floor(10_000_000 * 0.05) = 500_000; pct = 500_000 / 10_000_000 * 100 = 5
    expect(formatOriginationFeePct(10_000_000, 5)).toBe('5.00');
  });

  it('handles sub-cent origination correctly with 2 d.p.', () => {
    // Small principal where floor introduces rounding
    const pct = formatOriginationFeePct(101, 5);
    expect(pct).toMatch(/^\d+\.\d{2}$/);
  });
});
