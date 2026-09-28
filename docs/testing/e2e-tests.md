# E2E Testing Guide

This guide explains how to install, run, write, and debug end-to-end (E2E) tests for the StellarKraal frontend using [Playwright](https://playwright.dev/).

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Installing Playwright](#installing-playwright)
- [Configuration](#configuration)
- [Running Tests Locally](#running-tests-locally)
- [Running in CI](#running-in-ci)
- [Debugging with Playwright Inspector](#debugging-with-playwright-inspector)
- [Test Utilities and Patterns](#test-utilities-and-patterns)
- [Test File Reference](#test-file-reference)
- [Writing New Tests](#writing-new-tests)
- [Recording Tests with Codegen](#recording-tests-with-codegen)
- [Related Test Suites](#related-test-suites)
- [Troubleshooting](#troubleshooting)

---

## Overview

The E2E tests live in `frontend/tests/e2e/` and use Playwright to drive a real Chromium browser against a running Next.js dev server. They exercise critical user journeys — wallet connection, collateral registration, loan requests, repayments, and offline behaviour — without requiring a real Freighter wallet extension or a live backend.

All external dependencies (wallet, backend API) are mocked at the browser level so tests remain fast, deterministic, and runnable in any environment.

```
frontend/
├── tests/
│   ├── e2e/                        # E2E tests (this guide)
│   │   ├── wallet-collateral-loan.spec.ts
│   │   ├── loan-repayment.spec.ts
│   │   ├── offline-form-submission.spec.ts
│   │   └── navbar-mobile.spec.ts
│   ├── a11y/                       # Accessibility tests
│   └── visual/                     # Visual regression tests
├── playwright.e2e.config.ts        # E2E configuration
├── playwright-a11y.config.ts       # Accessibility configuration
└── playwright.visual.config.ts     # Visual regression configuration
```

---

## Prerequisites

- Node.js **20.x** or higher (`node --version`)
- npm **10.x** or higher (`npm --version`)
- Frontend dependencies installed: `cd frontend && npm install`

---

## Installing Playwright

Playwright is already listed as a dev dependency in `frontend/package.json`. Running `npm install` fetches the package, but browser binaries must be installed separately (once per machine):

```bash
cd frontend
npm install
npx playwright install chromium
```

The E2E suite uses Chromium only. If you also want to run accessibility or visual tests, install all browsers:

```bash
npx playwright install
```

To include system-level OS dependencies (required in clean CI environments or Docker):

```bash
npx playwright install --with-deps chromium
```

---

## Configuration

E2E tests are configured in `frontend/playwright.e2e.config.ts`. The key settings are:

| Setting | Value | Notes |
|---|---|---|
| `testDir` | `./tests/e2e` | All `*.spec.ts` files in this directory are discovered |
| Browser | Chromium (Desktop Chrome) | Single browser to keep CI fast |
| `baseURL` | `http://localhost:3000` | Override with `PLAYWRIGHT_BASE_URL` env var |
| `trace` | `on-first-retry` | Trace ZIP generated on the first retry of a failed test |
| HTML report | `playwright-report/e2e/` | Open with `npx playwright show-report` |
| JSON report | `test-results/e2e-results.json` | Machine-readable results |
| `forbidOnly` | `true` in CI | Prevents accidental `.only()` from blocking all other tests |
| `retries` | `2` in CI, `0` locally | Automatic retry for flaky tests in CI |
| `workers` | `1` in CI, default locally | Sequential in CI for consistency |

### Web server auto-start

By default Playwright starts `npm run dev` automatically before running tests and waits for `http://localhost:3000` to respond. If you already have the dev server running, skip the auto-start:

```bash
PLAYWRIGHT_EXTERNAL_SERVER=1 npm run test:e2e
```

---

## Running Tests Locally

All commands run from the `frontend/` directory.

### Run the full E2E suite

```bash
cd frontend
npm run test:e2e
```

This starts the Next.js dev server, runs all tests in `tests/e2e/`, then generates the HTML report.

### Run a single test file

```bash
cd frontend
npx playwright test -c playwright.e2e.config.ts tests/e2e/loan-repayment.spec.ts
```

### Run a single test by name

```bash
cd frontend
npx playwright test -c playwright.e2e.config.ts -g "shows error when user rejects"
```

### Run in headed mode (visible browser)

```bash
cd frontend
npx playwright test -c playwright.e2e.config.ts --headed
```

Useful for watching what a failing test actually does.

### Run with an external server

If the dev server is already running in another terminal:

```bash
cd frontend
PLAYWRIGHT_EXTERNAL_SERVER=1 npm run test:e2e
```

### View the HTML report

```bash
cd frontend
npx playwright show-report playwright-report/e2e
```

---

## Running in CI

CI is defined in `.github/workflows/e2e.yml`. The workflow:

1. Checks out the repo and sets up Node 20.
2. Installs frontend dependencies with `npm ci --legacy-peer-deps`.
3. Installs Chromium plus system dependencies with `npx playwright install --with-deps chromium`.
4. Starts the full Docker Compose test environment (backend + frontend containers).
5. Polls `http://localhost:3000` until the frontend is ready (up to 150 seconds).
6. Runs `npm run test:e2e` with `PLAYWRIGHT_EXTERNAL_SERVER=1` and `PLAYWRIGHT_BASE_URL=http://localhost:3000` so Playwright does not start a second server.
7. Uploads `frontend/test-results/` and `frontend/playwright-report/` as an artifact named `e2e-results` (retained for 30 days).

The workflow runs on every push to `main` and `develop` and on every pull request targeting `main`.

### Downloading a CI report

1. Go to the failed workflow run in GitHub Actions.
2. Click **Artifacts** → **e2e-results**.
3. Extract the ZIP and open `playwright-report/e2e/index.html` in a browser.

### Inspecting a CI trace

When a test fails in CI a trace ZIP is produced on the first retry. It is included in the `e2e-results` artifact.

```bash
# After downloading and extracting the artifact:
npx playwright show-trace path/to/trace.zip
```

---

## Debugging with Playwright Inspector

### Step through a test interactively

```bash
cd frontend
npx playwright test -c playwright.e2e.config.ts --debug
```

Playwright Inspector opens alongside the browser. You can:
- Step through each action with the **Step** button.
- Inspect the current DOM state and locator highlights.
- Run arbitrary `page.locator()` calls in the console.
- Pause at any point with `await page.pause()` in your test code.

### Pause at a specific point

Insert `await page.pause()` anywhere in a test, then run in debug mode:

```typescript
test("my test", async ({ page }) => {
  await page.goto("/borrow");
  await page.pause(); // Playwright Inspector opens here
  await page.getByRole("button", { name: /connect/i }).click();
});
```

### Run one test in debug mode

```bash
cd frontend
npx playwright test -c playwright.e2e.config.ts tests/e2e/navbar-mobile.spec.ts --debug
```

### Increase timeout for long investigations

```typescript
test("my slow test", async ({ page }) => {
  test.setTimeout(120_000); // 2 minutes
  // ...
});
```

---

## Test Utilities and Patterns

No shared fixtures file exists yet — the helpers are defined as plain async functions at the top of each spec file that needs them. The two most important patterns are used in `loan-repayment.spec.ts` and can be reused when writing new tests.

### `injectMockWallet(page, opts?)`

Injects a fully-mocked Freighter-compatible wallet into the browser page **before** any navigation. The mock is registered on `window.__STELLARKRAAL_E2E__`, which the app checks for in development/test mode and uses instead of the real Freighter API.

```typescript
/**
 * Call this before page.goto(). It must run before the app scripts load.
 *
 * @param opts.rejectSign - When true, signTransaction() throws to simulate
 *                          the user clicking "Reject" in their wallet.
 */
async function injectMockWallet(
  page: Page,
  opts: { rejectSign?: boolean } = {}
) {
  await page.addInitScript(
    ({ walletAddress, rejectSign }) => {
      const state = { signCalls: 0, submitCalls: 0 };

      window.__STELLARKRAAL_E2E__ = {
        async isConnected() { return { isConnected: true }; },
        async isAllowed()   { return { isAllowed: true }; },
        async setAllowed()  { return { isAllowed: true }; },
        async getAddress()  { return { address: walletAddress }; },

        async signTransaction(xdr: string) {
          state.signCalls += 1;
          (window as any).__STELLARKRAAL_E2E_STATE__ = state;
          if (rejectSign) throw new Error("User declined to sign the transaction.");
          return { signedTxXdr: `${xdr}-signed` };
        },

        async submitSignedXdr() {
          state.submitCalls += 1;
          (window as any).__STELLARKRAAL_E2E_STATE__ = state;
          return "mock-tx-hash";
        },
      };
    },
    { walletAddress: WALLET_ADDRESS, rejectSign: opts.rejectSign ?? false }
  );
}
```

The `__STELLARKRAAL_E2E_STATE__` object lets tests assert on call counts from within the test:

```typescript
// Assert that signTransaction was called at least once
await expect.poll(
  async () =>
    page.evaluate(() => (window as any).__STELLARKRAAL_E2E_STATE__?.signCalls ?? 0),
  { timeout: 10_000 }
).toBeGreaterThan(0);
```

### `setupRouteMocks(page, loanRef)`

Intercepts all relevant backend API calls using `page.route()`. Passing a mutable `loanRef` object lets a test simulate a state change mid-test (e.g., status changing from `"active"` to `"repaid"` after the wallet signs):

```typescript
async function setupRouteMocks(page: Page, loanRef: LoanRow) {
  await page.route("**/api/health/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ health_factor: 1.8 }) })
  );
  await page.route("**/api/transactions**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ data: [] }) })
  );
  await page.route("**/api/loans", (route) =>
    route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify([loanRef]) })
  );
  await page.route("**/api/loans/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify(loanRef) })
  );
  await page.route("**/api/loan/repay**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ xdr: "mock-repayment-xdr" }) })
  );
}

// Later in the test, mutate loanRef to simulate a backend state change:
loan.status = "repaid";
loan.outstandingBalance = UPDATED_OUTSTANDING;
// The next page.route() handler for GET /api/loans/1 will return the new state
```

### Offline simulation

Use the Playwright browser context to toggle offline mode. This flips `navigator.onLine` and fires the `offline`/`online` window events:

```typescript
test("disables form while offline", async ({ page, context }) => {
  await context.setOffline(true);
  await expect(page.getByRole("alert", { name: /you are offline/i })).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByRole("alert", { name: /you are offline/i })).toHaveCount(0);
});
```

### Viewport override

Use `test.use()` at the top of a `describe` block to pin a viewport for mobile tests:

```typescript
test.use({ viewport: { width: 375, height: 667 } });

test.describe("Mobile bottom tab bar", () => {
  // All tests in this block run at 375×667
});
```

---

## Test File Reference

### `wallet-collateral-loan.spec.ts`

The primary happy-path journey. Covers the full borrow wizard from wallet connection through to a loan appearing on `/loans`.

Steps exercised:
1. Connect mocked Freighter wallet.
2. Step 1 of 4 — Register collateral (animal type, count, appraised value).
3. Step 2 of 4 — Set loan amount.
4. Step 3 of 4 — Review terms.
5. Step 4 of 4 — Confirm and submit loan request.
6. Assert "Loan disbursed!" confirmation.
7. Navigate to `/loans` and assert the new loan is listed.

API routes mocked: `POST /api/collateral/register`, `GET /api/v1/loans/estimate`, `POST /api/loan/request`, `GET /api/loans`, `GET /api/transactions`, `GET /api/health/*`.

---

### `loan-repayment.spec.ts`

Tests the repayment flow with two cases.

**Happy path:**
1. Navigate to `/loans/:id` for an active loan.
2. Click **Repay**, fill amount, click **Confirm**.
3. Assert `signTransaction` and `submitSignedXdr` were called.
4. Assert the modal closes and the loan status changes to `"repaid"`.
5. Assert the updated outstanding balance is shown.

**Wallet rejection error case:**
1. Configure `injectMockWallet` with `{ rejectSign: true }`.
2. Open the repayment modal and click **Confirm**.
3. Assert an error message matching `/rejected|declined|failed|error|cancelled/i` is shown.
4. Assert the loan status has **not** changed to `"repaid"`.

---

### `offline-form-submission.spec.ts`

Verifies the `useNetworkStatus` hook and `OfflineBanner` component.

1. Load `/borrow` with wallet connected.
2. Assert the submit button is enabled and no offline banner is visible.
3. Call `context.setOffline(true)`.
4. Assert the offline banner (`role="alert"`) appears and the submit button is disabled.
5. Call `context.setOffline(false)`.
6. Assert the banner disappears and the submit button re-enables.

---

### `navbar-mobile.spec.ts`

Runs at a 375×667 viewport (iPhone SE) to verify the mobile bottom tab bar.

1. Assert the `navigation` landmark with accessible name "Mobile bottom navigation" is visible.
2. Assert all four links (Dashboard, Loans, Collateral, Profile) are present.
3. Assert the hamburger button is absent.
4. Click the Loans tab and assert the URL changes to `/loans`.
5. Assert `ArrowRight` moves keyboard focus from the Dashboard tab to the Loans tab.

---

## Writing New Tests

### Minimal template

```typescript
import { test, expect } from "@playwright/test";

const WALLET_ADDRESS = "GTESTWALLETADDRESS1234567890ABCDEFGH1234567890";

test.describe("feature name (E2E)", () => {
  test("describe what the test proves", async ({ page }) => {
    // 1. Inject mock wallet (must be before page.goto)
    await page.addInitScript(
      ({ walletAddress }) => {
        window.__STELLARKRAAL_E2E__ = {
          async isConnected() { return { isConnected: true }; },
          async isAllowed()   { return { isAllowed: true }; },
          async setAllowed()  { return { isAllowed: true }; },
          async getAddress()  { return { address: walletAddress }; },
          async signTransaction(xdr: string) {
            return { signedTxXdr: `${xdr}-signed` };
          },
          async submitSignedXdr() { return "mock-tx-hash"; },
        };
      },
      { walletAddress: WALLET_ADDRESS }
    );

    // 2. Mock API routes
    await page.route("**/api/loans", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      })
    );

    // 3. Navigate
    await page.goto("/loans");

    // 4. Assert
    await expect(page.getByText(/no loans/i)).toBeVisible();
  });
});
```

### Best practices

- **Call `page.addInitScript()` before `page.goto()`** — the script must be registered before the page loads, or the app will not find `window.__STELLARKRAAL_E2E__`.
- **Mock every API route your page calls** — unmocked routes will attempt real network calls and either fail or return unexpected data.
- **Prefer role and label selectors** — `getByRole("button", { name: /repay/i })` survives UI refactors better than CSS class selectors.
- **Use `expect.poll()` for async state changes** — for example, waiting for a status badge to change after an async wallet call completes.
- **One journey per test** — focused tests are easier to diagnose when they fail.
- **Use `test.describe()` to group related tests** — the describe label appears in reports and makes CI output easy to scan.
- **Include the issue number** in the `test.describe` label (e.g., `"loan repayment flow (E2E) — #565"`) so failures link back to their originating issue.

---

## Recording Tests with Codegen

Playwright Codegen records your browser interactions and generates a test file automatically. It is the fastest way to scaffold a new test.

### Basic usage

```bash
cd frontend
npx playwright codegen http://localhost:3000
```

A browser window and the Codegen recorder open side by side. Interact with the app — every click, type, and navigation is captured as a Playwright action in the recorder panel. When you are done, copy the generated code into a new `*.spec.ts` file in `tests/e2e/`.

> **Note:** The dev server must be running before you launch codegen. Start it in another terminal with `npm run dev` or use `PLAYWRIGHT_EXTERNAL_SERVER=1` once it is already running.

### Codegen with a specific viewport

To record a mobile viewport:

```bash
cd frontend
npx playwright codegen --viewport-size=375,667 http://localhost:3000
```

### Codegen with a starting URL

Jump directly to a feature:

```bash
cd frontend
npx playwright codegen http://localhost:3000/borrow
```

### Cleaning up generated code

Codegen output is a starting point, not production-ready test code. After recording:

1. Replace generic `page.locator(".css-class")` selectors with semantic ones (`getByRole`, `getByLabel`, `getByText`).
2. Add `page.addInitScript()` to inject the wallet mock — codegen cannot record this.
3. Add `page.route()` calls to mock API responses.
4. Remove any assertions that test implementation details (CSS, internal state).
5. Wrap the test in a `test.describe()` block with an issue reference.

---

## Related Test Suites

The frontend has three Playwright configurations for different concerns.

### Accessibility tests

```bash
cd frontend
npm run test:a11y
```

Config: `playwright-a11y.config.ts`. Tests in `tests/a11y/`. Runs against `http://localhost:3005` (a separate port to avoid conflicts). Uses `@axe-core/playwright` to run automated axe audits on each page.

### Visual regression tests

```bash
# Check current screenshots against committed baselines
cd frontend
npm run test:visual

# Update baselines after an intentional visual change
cd frontend
npm run test:visual:update
```

Config: `playwright.visual.config.ts`. Tests in `tests/visual/`. Runs four project variants: `desktop-light`, `desktop-dark`, `mobile-light`, `mobile-dark`. Baselines are PNG files committed in `tests/visual/__snapshots__/`. CI fails if any screenshot differs by more than 0.1% of pixels (`maxDiffPixelRatio: 0.001`).

Always commit updated baseline screenshots in the same PR as the visual change that caused them.

---

## Troubleshooting

### `Error: port 3000 already in use`

A previous dev server did not shut down cleanly.

```bash
lsof -ti:3000 | xargs kill -9
```

Or skip the auto-start:

```bash
PLAYWRIGHT_EXTERNAL_SERVER=1 npm run test:e2e
```

### `window.__STELLARKRAAL_E2E__ is undefined`

The wallet mock was not injected before the page loaded. Ensure `page.addInitScript()` is called **before** `page.goto()`.

```bash
# Confirm the injection works by stepping through in debug mode:
npx playwright test -c playwright.e2e.config.ts --debug
```

### Test times out

The default timeout is 30 seconds. Increase it for a specific test:

```typescript
test("slow test", async ({ page }) => {
  test.setTimeout(60_000);
  // ...
});
```

If the whole suite is slow, ensure the dev server is fully started before Playwright tries to connect. The `webServer.timeout` in `playwright.e2e.config.ts` can be raised if needed.

### `net::ERR_CONNECTION_REFUSED` on API routes

The app is making a real network call that was not intercepted. Add a `page.route()` handler for that URL pattern before `page.goto()`.

Use the **Network** tab in the Playwright trace viewer to identify which URL was not mocked.

### Traces or screenshots not generated

Verify the config settings in `playwright.e2e.config.ts`:

```typescript
use: {
  trace: "on-first-retry",       // trace ZIP on first retry
  screenshot: "only-on-failure", // screenshot on failure
},
```

Traces require a **retry** to trigger — run with `--retries=1` locally to force generation:

```bash
npx playwright test -c playwright.e2e.config.ts --retries=1
```

### `forbidOnly` error in CI

A `test.only()` was left in the code. Remove it before pushing. The `forbidOnly: !!process.env.CI` config setting exists specifically to catch this.

---

## Related Documentation

- [Playwright documentation](https://playwright.dev/)
- [Accessibility Guide](../guides/accessibility.md) — ARIA patterns, a11y testing commands
- [Freighter Wallet Integration](../guides/freighter-integration.md) — `window.__STELLARKRAAL_E2E__` mock API details
- [Coverage Requirements](./coverage-requirements.md) — overall test coverage thresholds
- [CONTRIBUTING.md](../../CONTRIBUTING.md) — branch naming, commit style, PR checklist
