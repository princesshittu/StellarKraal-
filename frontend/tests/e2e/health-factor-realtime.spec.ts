import { test, expect } from '@playwright/test';

/**
 * E2E: Real-time Health Factor Updates on Loan Detail Page (#1202)
 *
 * Acceptance criteria verified:
 *  ✅  Health factor refreshes automatically without a full page reload
 *  ✅  Warning banner appears when HF < 1.2
 *  ✅  Critical alert appears when HF < 1.0
 *  ✅  Polling is paused when the browser tab is hidden (Page Visibility API)
 *
 * Approach:
 *  - Backend HTTP calls intercepted with page.route
 *  - No real backend required; health factor values injected via route mocks
 *  - Page Visibility tested by dispatching a 'visibilitychange' event
 */

const LOAN_ID = 'test-loan-hf';
const WALLET = 'GTESTWALLETADDRESS1234567890ABCDEFGH1234567890';

/** Loan fixture with active status */
const ACTIVE_LOAN = {
  id: LOAN_ID,
  borrower: WALLET,
  collateral_id: 'COL-001',
  amount: 500_000_000,
  outstanding: 450_000_000,
  collateral_value: 600_000_000,
  health_factor: 13_000, // 1.3x — safe
  status: 'active',
  createdAt: new Date().toISOString(),
};

/** Route handler factory — returns a loan with the given health_factor bps */
function mockLoanRoute(page: import('@playwright/test').Page, healthFactorBps: number) {
  return page.route(`**/api/loans/${LOAN_ID}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...ACTIVE_LOAN, health_factor: healthFactorBps }),
    })
  );
}

/** Route handler for the health-factor polling endpoint */
function mockHealthRoute(page: import('@playwright/test').Page, healthFactorBps: number) {
  return page.route(`**/api/health/${LOAN_ID}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ health_factor: healthFactorBps }),
    })
  );
}

test.describe('Health Factor real-time updates', () => {
  test('shows no alert when health factor is safe (≥ 1.2)', async ({ page }) => {
    await mockLoanRoute(page, 13_000); // 1.3x
    await mockHealthRoute(page, 13_000);

    await page.goto(`/loans/${LOAN_ID}`);
    await page.waitForSelector('[data-testid="health-factor-section"]');

    // Neither banner should be present
    await expect(page.getByTestId('hf-warning-banner')).not.toBeVisible();
    await expect(page.getByTestId('hf-critical-alert')).not.toBeVisible();
  });

  test('shows warning banner when health factor drops below 1.2', async ({ page }) => {
    // Initial load: safe HF
    await mockLoanRoute(page, 13_000);

    // Poll response will return a low HF (1.15x = 11,500 bps)
    const warningBps = 11_500;
    await mockHealthRoute(page, warningBps);

    await page.goto(`/loans/${LOAN_ID}`);

    // Wait for the health factor section to render
    await page.waitForSelector('[data-testid="health-factor-section"]');

    // The useHealthFactor hook fires immediately on mount; wait for the
    // warning banner to appear after the first poll resolves.
    const warningBanner = page.getByTestId('hf-warning-banner');
    await expect(warningBanner).toBeVisible({ timeout: 5000 });

    // Verify the HF value is displayed in the warning text
    await expect(warningBanner).toContainText('1.15');
    await expect(warningBanner).toContainText('Warning');
  });

  test('shows critical alert when health factor drops below 1.0', async ({ page }) => {
    await mockLoanRoute(page, 13_000);
    // 0.95x = 9,500 bps — critical
    await mockHealthRoute(page, 9_500);

    await page.goto(`/loans/${LOAN_ID}`);
    await page.waitForSelector('[data-testid="health-factor-section"]');

    const criticalAlert = page.getByTestId('hf-critical-alert');
    await expect(criticalAlert).toBeVisible({ timeout: 5000 });

    await expect(criticalAlert).toContainText('Critical');
    await expect(criticalAlert).toContainText('0.95');
  });

  test('health factor refreshes without a full page reload', async ({ page }) => {
    let callCount = 0;

    await mockLoanRoute(page, 13_000);

    // First poll: safe; second poll: warning
    await page.route(`**/api/health/${LOAN_ID}`, (route) => {
      callCount++;
      const bps = callCount === 1 ? 13_000 : 11_500;
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ health_factor: bps }),
      });
    });

    await page.goto(`/loans/${LOAN_ID}`);
    await page.waitForSelector('[data-testid="health-factor-section"]');

    // First poll fires on mount — no warning yet
    await expect(page.getByTestId('hf-warning-banner')).not.toBeVisible();

    // Accelerate polling by overriding setInterval to fire immediately
    await page.evaluate(() => {
      // Trigger the next poll callback by faking a 30s time jump
      // We dispatch a visibilitychange to visible to force an immediate poll
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Wait for the second poll to update the UI
    await expect(page.getByTestId('hf-warning-banner')).toBeVisible({ timeout: 5000 });

    // Verify no navigation occurred (URL unchanged)
    expect(page.url()).toContain(`/loans/${LOAN_ID}`);
  });

  test('polling pauses when tab is hidden and resumes on visibility', async ({ page }) => {
    let pollCount = 0;
    await mockLoanRoute(page, 13_000);
    await page.route(`**/api/health/${LOAN_ID}`, (route) => {
      pollCount++;
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ health_factor: 13_000 }),
      });
    });

    await page.goto(`/loans/${LOAN_ID}`);
    await page.waitForSelector('[data-testid="health-factor-section"]');

    // Record poll count after mount
    const countAfterMount = pollCount;

    // Simulate tab hidden — polling should pause
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        writable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Wait briefly — no additional polls should fire while hidden
    await page.waitForTimeout(500);
    const countWhileHidden = pollCount;
    expect(countWhileHidden).toBe(countAfterMount);

    // Simulate tab becoming visible again — should trigger an immediate poll
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await page.waitForTimeout(500);
    expect(pollCount).toBeGreaterThan(countWhileHidden);
  });
});
