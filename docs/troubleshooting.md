# Troubleshooting Guide

Common errors encountered when developing or running StellarKraal, organised by category with cause and resolution for each.

---

## Setup

### 1. `npm ERR! code ERESOLVE` — dependency conflict on install

**Symptom:** `npm install` fails with `ERESOLVE unable to resolve dependency tree`.

**Cause:** Mismatched peer dependency versions, often triggered by running the wrong Node.js version.

**Resolution:**
1. Confirm you are on Node.js 20+: `node --version`
2. Delete cached state and reinstall:
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```

---

### 2. `stellar: command not found`

**Symptom:** Running `stellar` or `stellar-cli` in the terminal returns `command not found`.

**Cause:** The Stellar CLI was installed via Cargo but `~/.cargo/bin` is not on `PATH`.

**Resolution:**
```bash
export PATH="$HOME/.cargo/bin:$PATH"
```
Add that line to your shell profile (`~/.bashrc`, `~/.zshrc`, etc.) to make it permanent.

---

### 3. `error: failed to run custom build command for 'soroban-env-host'`

**Symptom:** `cargo build` or `cargo test` inside `contracts/stellarkraal` fails with the above error.

**Cause:** The `wasm32-unknown-unknown` Rust target is missing.

**Resolution:**
```bash
rustup target add wasm32-unknown-unknown
```

---

### 4. `Error: Cannot find module 'sqlite3'` / `sqlite3 module not found`

**Symptom:** The backend fails to start with a missing `sqlite3` module error.

**Cause:** The native `sqlite3` addon failed to compile during `npm install` due to missing build tools.

**Resolution:**
- **Linux:** `sudo apt install build-essential libsqlite3-dev`
- **macOS:** `xcode-select --install`
- Then rebuild the addon: `npm rebuild sqlite3` inside `backend/`

---

### 5. `cp: cannot stat 'env.example': No such file or directory`

**Symptom:** `cp env.example .env` fails after cloning.

**Cause:** The file is named `.env.example` in some branches and `env.example` in others.

**Resolution:** Check which file exists and copy the correct one:
```bash
ls .env.example env.example 2>/dev/null
cp .env.example .env   # or: cp env.example .env
```

---

## Runtime

### 6. `Error: listen EADDRINUSE :::3001` — PORT already in use

**Symptom:** The backend refuses to start with `EADDRINUSE`.

**Cause:** Another process is already bound to port 3001 (or whichever port `PORT` is set to).

**Resolution:**
```bash
# Find the process
lsof -i :3001
# Kill it
kill -9 <PID>
```
Or change `PORT` in `.env` to a free port.

---

### 7. `Cannot connect to RPC_URL` / `fetch failed` calling Soroban RPC

**Symptom:** API calls that invoke the smart contract return network errors or timeouts.

**Cause:** `RPC_URL` in `.env` is wrong, the testnet endpoint is temporarily down, or there is no internet access.

**Resolution:**
1. Verify the value: `grep RPC_URL .env`
2. Test reachability: `curl -s https://soroban-testnet.stellar.org` should return JSON.
3. If the public testnet is down, check [Stellar Status](https://status.stellar.org/) or switch to a local Stellar node.

---

### 8. `CORS policy` error in browser — frontend API requests blocked

**Symptom:** Browser console shows `Access to fetch at 'http://localhost:3001' from origin 'http://localhost:3000' has been blocked by CORS policy`.

**Cause:** `FRONTEND_URL` is not set or does not match the origin the frontend is served from.

**Resolution:** Add or correct the variable in `.env`:
```
FRONTEND_URL=http://localhost:3000
```
Restart the backend after saving.

---

### 9. `JsonWebTokenError: invalid signature` / `401 Unauthorized` on API requests

**Symptom:** Authenticated API endpoints return 401 with a JWT error in the backend logs.

**Cause:** `JWT_SECRET` differs between the process that issued the token and the process validating it (e.g., after rotating the secret without re-logging in).

**Resolution:**
1. Ensure `JWT_SECRET` is identical across all backend instances and matches the value used when the token was issued.
2. Clear browser storage / cookies and log in again to obtain a fresh token.

---

### 10. Frontend stuck on loading — `backend` health check failing in Docker

**Symptom:** `docker compose up` starts but the frontend never becomes available; `docker compose ps` shows `frontend` as `starting`.

**Cause:** The frontend waits for the backend to pass its health check (`GET /api/health`). If the backend is unhealthy, the frontend never starts.

**Resolution:**
```bash
docker compose logs backend
```
Fix the underlying backend error (often a missing env variable or failed migration), then:
```bash
docker compose restart backend
```

---

## Contract

### 11. `HostError: Error(Contract, #10)` — contract invocation rejected

**Symptom:** A contract call returns a `HostError` with a contract-defined error code.

**Cause:** The contract enforced a business rule (e.g., loan-to-value exceeded, collateral already locked, unauthorised caller).

**Resolution:**
1. Check the error code against the contract source in `contracts/stellarkraal/src/lib.rs`.
2. Verify the inputs (collateral ID, loan amount, caller address) satisfy the contract's preconditions.
3. Run `cargo test` locally to reproduce the scenario in a unit test.

---

### 12. `TransactionResultCode.txBAD_SEQ` — transaction sequence number mismatch

**Symptom:** Submitting a transaction via Freighter or the backend returns `txBAD_SEQ`.

**Cause:** The account's sequence number on-chain is ahead of what the client cached, usually because another transaction was submitted concurrently.

**Resolution:**
1. Refresh the account sequence number before building the transaction.
2. In the backend, ensure no two code paths submit transactions for the same account simultaneously.
3. Retry the operation — the client will fetch the latest sequence number on the next attempt.

---

### 13. `Contract not found` / `invoke_contract` returns `MissingValue`

**Symptom:** Any contract invocation fails with a "not found" or missing value error.

**Cause:** `CONTRACT_ID` in `.env` points to a contract that has not been deployed to the current network, or the wrong network is selected.

**Resolution:**
1. Confirm the network: `grep NEXT_PUBLIC_NETWORK .env`
2. Confirm the contract is deployed: `stellar contract info --id $CONTRACT_ID --network testnet`
3. If not deployed, follow `docs/deployment/contract-deployment.md` to deploy and update `CONTRACT_ID`.

---

## Database

### 14. `SQLITE_CANTOPEN: unable to open database file`

**Symptom:** The backend logs `SQLITE_CANTOPEN` on startup.

**Cause:** The SQLite file path configured in `database.json` does not exist or the process lacks write permission.

**Resolution:**
```bash
# Check the configured path
cat backend/database.json
# Ensure the directory is writable
ls -la backend/
# Create the file if missing (migrations will populate it)
touch backend/dev.sqlite3
npm run migrate:dev --prefix backend
```

---

### 15. `Migration failed: table already exists`

**Symptom:** Running `npm run migrate:dev` fails with a "table already exists" error.

**Cause:** A previous partial migration left the database in an inconsistent state, or migrations were run twice.

**Resolution:**
1. For a development database it is safe to reset:
   ```bash
   rm backend/dev.sqlite3
   npm run migrate:dev --prefix backend
   ```
2. For a shared or staging database, inspect the `migrations` table and manually mark the failed migration as rolled back before re-running.

---

## Freighter Wallet

StellarKraal uses the [Freighter browser extension](https://www.freighter.app/) to sign
Stellar transactions without exposing private keys to the web page. The entries in this
section cover the most common integration problems: extension not installed, network mismatch
between the wallet and the app, browser popup blocking, and user-cancelled transactions.

For the full Freighter integration reference — including the `freighterClient.ts` wrapper API,
the `useWallet` hook, mock setup for tests, and network switching details — see
**[docs/guides/freighter-integration.md](guides/freighter-integration.md)**.

### 16. Freighter extension not installed or not detected — `isConnected()` returns `false`

**Symptom:** The wallet connect button shows "Install Freighter" or the app reports the wallet is unavailable even after the extension is installed.

**Cause:** The Freighter browser extension is either not installed, or the page loaded before the extension had time to inject its API into `window.freighter`.

**Resolution:**
- **Desktop (Chrome/Brave/Firefox):** Install or enable the [Freighter extension](https://www.freighter.app/). After installation, do a **hard refresh** (`Ctrl+Shift+R` / `Cmd+Shift+R`) to let the extension inject into the page.
- **Mobile browsers:** Freighter is a desktop-only extension. Mobile users cannot connect a Freighter wallet directly. Use a desktop browser or check if the app offers an alternative signing flow.
- After a fresh install, close and reopen the browser tab so the extension is fully loaded before the page runs.

---

### 17. Wallet locked — `getAddress()` or `signTransaction()` returns an error

**Symptom:** The wallet API returns a rejection or empty response when trying to fetch the public key or sign a transaction. The Freighter extension may prompt a password entry.

**Cause:** The Freighter extension is installed but the wallet is locked (requires password entry before it can expose the public key or sign).

**Resolution:**
1. Click the Freighter extension icon in the browser toolbar.
2. Unlock the wallet with your password.
3. Return to the StellarKraal tab and retry the action. No page refresh is needed.

If Freighter closes the popup before you can approve a transaction, make sure your browser isn't blocking extension popups (check popup-blocker settings).

---

### 18. Wrong network selected in Freighter — transactions rejected or silently fail

**Symptom:** Transactions are built successfully but submission fails. The frontend shows a network mismatch banner (`NetworkMismatchBanner`). Freighter may report a passphrase mismatch.

**Cause:** Freighter's selected network (e.g., Mainnet) does not match the network the app is configured for via `NEXT_PUBLIC_NETWORK` (e.g., Testnet). Transaction signing requires matching network passphrases.

**Resolution:**
1. Open the Freighter extension and click the network name at the top (e.g., "Mainnet").
2. Switch to **Testnet** (or whichever network the app is running on).
3. If the target network is not listed, add a custom network using the RPC endpoint from your `.env` (`RPC_URL`).
4. Reload the app — the mismatch banner should disappear.

**Desktop vs mobile:** This applies only to desktop browsers. The `useNetworkMismatch` hook in `frontend/src/hooks/useNetworkMismatch.ts` detects the mismatch and surfaces the banner automatically.

---

### 19. Transaction rejected by user — signing dialog dismissed

**Symptom:** The app shows a "transaction rejected" or "user cancelled" error after a Freighter popup appears.

**Cause:** The user dismissed the Freighter signing dialog, or the dialog timed out waiting for approval.

**Resolution:**
- This is expected behaviour when the user cancels. The app should display a dismissible error message and allow retrying.
- If the popup appears but closes immediately (without user action), check whether a browser extension (e.g., ad blocker or popup manager) is closing it automatically. Temporarily disable such extensions for the StellarKraal origin.
- If the signing popup never appears at all, ensure the extension is unlocked (see **Entry 17** above).

**Error code reference:** Freighter returns a `"User declined access"` or `"Transaction was rejected"` string in the rejected promise. The `freighterClient.ts` wrapper does not swallow these — they propagate to the calling component for display.

---

### 20. `txBAD_SEQ` after Freighter signs a transaction (wallet-side sequence number drift)

**Symptom:** Freighter successfully signs a transaction but submission fails with `TransactionResultCode.txBAD_SEQ`.

**Cause:** Freighter cached a stale account sequence number. This happens when multiple transactions are submitted in quick succession or when another client (CLI, a different browser tab) submitted a transaction for the same account.

**Resolution:**
1. Wait a few seconds, then retry — the frontend refetches the account's sequence number on each new transaction build.
2. If the error persists, clear Freighter's cached account data: open Freighter → Settings → Manage Assets → select the account → clear/refresh.
3. See also: **Entry 12** (`txBAD_SEQ` from the backend side) for backend-specific sequence handling.

---

### 21. Freighter signing popup blocked by the browser

**Symptom:** Clicking "Sign" or "Connect Wallet" triggers no visible Freighter popup. The browser may show a blocked-popup icon in the address bar. The app appears to hang until it times out with a rejection error.

**Cause:** The browser's built-in popup blocker (or a browser extension such as an ad blocker or privacy tool) prevented the Freighter extension popup from opening. Browsers block extension popups when they are not triggered by a direct user gesture, or when blanket popup blocking is enabled for the origin.

**Resolution:**

1. **Check the browser popup blocker.**
   - Chrome/Brave: look for the blocked popup icon (🚫) in the address bar → click it → select **"Always allow pop-ups and redirects from [origin]"** → confirm.
   - Firefox: yellow notification bar at the top of the page → **"Allow"** → reload.
   - Edge: click the blocked popup icon → **"Always allow"**.

2. **Disable interfering extensions temporarily.**
   - Ad blockers (uBlock Origin, AdBlock Plus), privacy tools (Privacy Badger), and popup managers can intercept extension events. Disable them for the StellarKraal origin and retry.
   - To identify the culprit, open the browser in a private/incognito window with extensions disabled: if the popup appears there, a specific extension is the cause.

3. **Ensure the sign action is triggered by a direct user gesture (click/tap).**
   - Freighter's `signTransaction` call must originate from a user event handler. If the call is deferred (e.g., inside a `setTimeout` or `Promise.then` chain that runs after the user gesture has expired), the browser may classify it as an automatic popup and block it.

4. **Verify the Freighter extension is unlocked** (see **Entry 17** above). A locked wallet may silently suppress the popup rather than prompting for a password in some browser configurations.

After unblocking popups, reload the StellarKraal tab and retry the action.

See **[docs/guides/freighter-integration.md](guides/freighter-integration.md)** for more on
the `signTransaction` call flow.

---

## Updating this guide

When a new common issue is identified, add an entry under the appropriate category following the format:

```
### N. `exact error message or symptom`

**Symptom:** What the developer sees.

**Cause:** Root cause.

**Resolution:** Step-by-step fix.
```
