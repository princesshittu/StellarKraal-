# CORS Configuration

This document explains how the StellarKraal backend handles Cross-Origin Resource Sharing (CORS), which origins are permitted, and how to configure them correctly for each environment.

---

## Contents

1. [Overview](#overview)
2. [How Origins Are Resolved](#how-origins-are-resolved)
3. [Credentials](#credentials)
4. [maxAge](#maxage)
5. [Per-Environment Configuration](#per-environment-configuration)
6. [Adding a New Allowed Origin](#adding-a-new-allowed-origin)
7. [Troubleshooting CORS Preflight Failures](#troubleshooting-cors-preflight-failures)
8. [Source References](#source-references)

---

## Overview

CORS is applied by `backend/src/middleware/cors.ts` as the first middleware in the Express stack (after Helmet). It reads allowed origins from environment variables at startup and validates them immediately — misconfigured origins cause the process to exit rather than silently accept or reject requests at runtime.

---

## How Origins Are Resolved

The middleware uses two env vars, with `ALLOWED_ORIGINS` taking precedence:

```
ALLOWED_ORIGINS  (comma-separated list of HTTP(S) URLs)
    ↓ if not set
FRONTEND_URL     (single HTTP(S) URL)
    ↓ if not set in production
CORS blocked     (warning logged at startup)
```

### `ALLOWED_ORIGINS`

Comma-separated list of origins to allow. Parsed and validated once at module load.

```bash
ALLOWED_ORIGINS=https://app.stellarkraal.example.com,https://staging.stellarkraal.example.com
```

Rules enforced at startup:

| Check | Development / Test | Production |
|-------|--------------------|-----------|
| Wildcard `*` | ✅ Allowed | ❌ Startup error |
| HTTP origins | ✅ Allowed | ✅ Allowed |
| HTTPS origins | ✅ Allowed | ✅ Allowed |
| Invalid pattern (e.g. no scheme, `ftp://`) | ❌ Startup error | ❌ Startup error |

Whitespace around each entry is stripped automatically.

### `FRONTEND_URL`

Fallback when `ALLOWED_ORIGINS` is not set. Accepts a single origin.

```bash
FRONTEND_URL=https://app.stellarkraal.example.com
```

In development, if neither variable is set, non-auth routes accept any origin (`*`) and auth routes use `credentials: true` (which implicitly restricts to the request origin). In production, neither variable being set logs a warning and blocks all cross-origin requests.

---

## Credentials

The `credentials: true` CORS option (which allows cookies and `Authorization` headers to be sent cross-origin) is only enabled for **API routes** (`/api/*` except `/api/health`). Static paths and the health endpoint use `credentials: false`.

This means:

- Auth routes (`/api/auth/*`, `/api/v1/auth/refresh`) support credentialed requests — browsers will send the `refreshToken` cookie and JWT header.
- Non-credentialed routes cannot be widened to `*` while `credentials: true` is active (this is a browser security constraint, not an application limit).

---

## `maxAge`

Preflight responses are cached by the browser for **600 seconds** (10 minutes). This reduces OPTIONS request overhead for clients that make many cross-origin calls.

---

## Per-Environment Configuration

### Local development

```bash
# Allow all origins — convenient for dev tools and local frontends
ALLOWED_ORIGINS=*
# or leave unset (same effect in development)
```

### Staging

```bash
ALLOWED_ORIGINS=https://staging.stellarkraal.example.com,https://app.stellarkraal.example.com
```

Or use the single-origin fallback:

```bash
FRONTEND_URL=https://staging.stellarkraal.example.com
```

### Production

```bash
# Must be HTTPS; wildcard is rejected
ALLOWED_ORIGINS=https://app.stellarkraal.example.com
```

If you deploy multiple frontend domains (e.g. A/B environments, white-label), list them all in `ALLOWED_ORIGINS`.

---

## Diagnosing CORS Errors

### Symptom: `Access-Control-Allow-Origin` header absent

1. Check that `ALLOWED_ORIGINS` or `FRONTEND_URL` is set and matches the origin in the request exactly (scheme + hostname + port).
2. Check the startup logs — an invalid pattern causes an immediate crash before any request is served.
3. Confirm the request origin is not using HTTP when only HTTPS is listed.

### Symptom: `Credentialed requests require exactly one Allow-Origin`

A wildcard `*` was used on a route that sends credentials (`Authorization` header or cookie). Set a specific origin in `ALLOWED_ORIGINS` instead.

### Symptom: `OPTIONS` preflight returns 4xx

The preflight hits the same CORS middleware. Ensure the origin is in the allowed list and that the requested method/headers are standard (`Content-Type`, `Authorization`).

### Check the running config

```bash
# Confirm what the process sees at startup
docker compose logs backend | grep -i "cors\|ALLOWED_ORIGINS\|FRONTEND_URL"
```

---

## Adding a New Allowed Origin

Use this procedure any time you need to permit a new domain — for example, a custom
integration client, a new staging branch deployment, or a white-label frontend.

### Step 1 — Identify the exact origin

An origin is `<scheme>://<host>[:<port>]`. Port is required only when it is non-standard (not 80 for HTTP or 443 for HTTPS).

| Scenario | Correct origin value |
|----------|----------------------|
| Production app | `https://app.stellarkraal.example.com` |
| Staging branch | `https://pr-42.staging.stellarkraal.example.com` |
| Local dev with custom port | `http://localhost:4000` |
| Custom integration (HTTPS) | `https://partner.example.com` |

> Do **not** include a trailing slash or a path: `https://app.example.com/` and
> `https://app.example.com/dashboard` are both wrong. Use `https://app.example.com`.

### Step 2 — Choose the right environment variable

- Use `ALLOWED_ORIGINS` (comma-separated) when more than one origin must be permitted,
  or when you want explicit, audit-friendly control over every allowed origin.
- Use `FRONTEND_URL` only for the single primary frontend URL as a quick shorthand when
  you have no need for multiple origins.

If both are set, `ALLOWED_ORIGINS` wins.

### Step 3 — Add the origin to the environment configuration

**Development (`.env` in the project root or `backend/.env`):**

```bash
# Add the new origin alongside any existing ones
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:4000
```

**Staging (GitHub Actions secret / ECS task definition):**

1. Navigate to **Settings → Environments → staging** in the GitHub repository.
2. Edit the `ALLOWED_ORIGINS` secret and append the new origin separated by a comma:

   ```
   https://staging.stellarkraal.example.com,https://pr-42.staging.stellarkraal.example.com
   ```

3. Trigger a new staging deployment or restart the ECS service:

   ```bash
   aws ecs update-service \
     --cluster stellarkraal-staging \
     --service stellarkraal-backend \
     --force-new-deployment \
     --profile stellarkraal-staging \
     --region us-east-1
   ```

**Production (AWS Secrets Manager / SSM):**

1. Update the `ALLOWED_ORIGINS` value in Secrets Manager:

   ```bash
   aws secretsmanager put-secret-value \
     --secret-id stellarkraal/production/ALLOWED_ORIGINS \
     --secret-string "https://app.stellarkraal.example.com,https://partner.example.com" \
     --profile stellarkraal-production \
     --region us-east-1
   ```

2. Force a new ECS deployment to pick up the updated secret:

   ```bash
   aws ecs update-service \
     --cluster stellarkraal-production \
     --service stellarkraal-backend \
     --force-new-deployment \
     --profile stellarkraal-production \
     --region us-east-1
   ```

> **Production note:** wildcard `*` is rejected at startup in production. Every
> origin must be a fully qualified HTTPS URL.

### Step 4 — Verify the new origin is accepted

Send a CORS preflight from the new origin and confirm the response includes the
`Access-Control-Allow-Origin` header with the new value:

```bash
# Replace NEW_ORIGIN with the origin you just added
curl -sv \
  -H "Origin: https://partner.example.com" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: Authorization" \
  -X OPTIONS \
  https://api.stellarkraal.example.com/api/v1/health \
  2>&1 | grep -i "access-control"
```

Expected output:

```
< Access-Control-Allow-Origin: https://partner.example.com
< Access-Control-Allow-Methods: GET,POST,PUT,PATCH,DELETE,OPTIONS
< Access-Control-Allow-Headers: Authorization,Content-Type
```

### Step 5 — Update documentation

If the new origin belongs to a long-lived integration (not a short-lived preview branch),
add a note to this file under [Per-Environment Configuration](#per-environment-configuration)
so the next engineer knows why it is listed.

---

## Troubleshooting CORS Preflight Failures

Use this section when the browser or an API client receives a CORS error.  Work
through the symptoms in order — most issues are resolved at step 1 or 2.

### Diagnosis flowchart

```
Browser shows CORS error
         │
         ▼
Is the backend responding at all?
  ├─ No  → Check backend health endpoint, ECS task status, firewall rules
  └─ Yes ▼
Does the OPTIONS preflight succeed (2xx)?
  ├─ No  → See "Preflight returns 4xx or 5xx" below
  └─ Yes ▼
Does the response include Access-Control-Allow-Origin?
  ├─ No  → Origin not in allowed list — see "Origin not permitted"
  └─ Yes ▼
Does the header value match the requesting origin exactly?
  ├─ No  → Mismatch (trailing slash, wrong port, HTTP vs HTTPS)
  └─ Yes → Check browser extensions, proxies, or iframe policies
```

---

### Origin not permitted

**Symptom:** The response is missing `Access-Control-Allow-Origin`, or the browser
console shows `No 'Access-Control-Allow-Origin' header is present`.

**Diagnosis:**

```bash
# Check what origins the backend is configured with
docker compose logs backend | grep -E "cors|ALLOWED_ORIGINS|FRONTEND_URL"

# Or inspect the running ECS task's environment
aws ecs describe-tasks \
  --cluster stellarkraal-staging \
  --tasks <task-arn> \
  --query 'tasks[0].containers[0].environment' \
  --profile stellarkraal-staging \
  --region us-east-1
```

**Resolution:** Follow the [Adding a New Allowed Origin](#adding-a-new-allowed-origin)
procedure to add the missing origin.

---

### Origin mismatch (scheme, host, or port)

**Symptom:** The `Access-Control-Allow-Origin` header is present, but its value does
not exactly match the request `Origin` header.

Common causes:

| Mismatch type | Example origin sent | Configured origin |
|---------------|--------------------|--------------------|
| Trailing slash | `https://app.example.com/` | `https://app.example.com` |
| HTTP vs HTTPS | `http://app.example.com` | `https://app.example.com` |
| Port mismatch | `http://localhost:3001` | `http://localhost:3000` |
| Subdomain typo | `https://staging.example.com` | `https://stagng.example.com` |

**Resolution:** Correct the origin in `ALLOWED_ORIGINS` (or the client URL) to match
exactly.

---

### Preflight returns `4xx` or `5xx`

**Symptom:** The OPTIONS request itself returns a `403`, `404`, `500`, or similar.

**Diagnosis steps:**

1. Confirm the CORS middleware loads before any auth middleware that might intercept
   OPTIONS requests prematurely:

   ```bash
   docker compose logs backend | grep -E "startup|cors|middleware" | head -20
   ```

2. Inspect the preflight response headers in detail:

   ```bash
   curl -sv -X OPTIONS \
     -H "Origin: https://app.stellarkraal.example.com" \
     -H "Access-Control-Request-Method: POST" \
     -H "Access-Control-Request-Headers: Authorization,Content-Type" \
     https://api.stellarkraal.example.com/api/v1/loans 2>&1
   ```

3. Look for startup errors — an invalid origin pattern (e.g. `ftp://example.com`) causes
   the process to exit:

   ```bash
   docker compose logs backend | grep -i "error\|invalid\|cors"
   ```

4. If behind a load balancer or API Gateway, ensure OPTIONS requests are forwarded and
   not blocked by WAF rules or listener rules.

---

### Credentialed request rejected by browser

**Symptom:** Browser error: _"Response to preflight request doesn't pass access control
check: The value of the 'Access-Control-Allow-Credentials' header in the response is ''
which must be 'true'"_ — or cookies / `Authorization` header not sent.

**Cause:** The route requires `credentials: true` but the origin is `*`, or the
`credentials` option is missing from the backend CORS config for that route prefix.

**Resolution:**

- Ensure the origin is a specific URL, not `*`.
- Confirm the request is to `/api/*` (where `credentials: true` is active).
- On the frontend, ensure `credentials: 'include'` (fetch) or `withCredentials: true`
  (axios/XHR) is set on the request.

---

### Preflight cached by browser (stale policy)

**Symptom:** After updating `ALLOWED_ORIGINS`, the browser still receives the old CORS
response even after an ECS redeployment.

**Cause:** The browser cached the preflight response for up to 600 seconds (`maxAge`).

**Resolution:** Wait 10 minutes, or open the browser DevTools → Application → Storage →
Clear site data to flush the preflight cache immediately. In Chrome, you can also disable
the preflight cache temporarily via `chrome://flags/#block-insecure-private-network-requests`.

---

- Middleware implementation: [`backend/src/middleware/cors.ts`](../backend/src/middleware/cors.ts)
- `ALLOWED_ORIGINS` format and examples: [`ALLOWED_ORIGINS/README.md`](../ALLOWED_ORIGINS/README.md)
- All env var defaults and validation: [`backend/src/config.ts`](../backend/src/config.ts)
- Troubleshooting CORS runtime errors: [`docs/troubleshooting.md`](troubleshooting.md)

## Source References

- Middleware implementation: [`backend/src/middleware/cors.ts`](../backend/src/middleware/cors.ts)
- `ALLOWED_ORIGINS` format and examples: [`ALLOWED_ORIGINS/README.md`](../ALLOWED_ORIGINS/README.md)
- All env var defaults and validation: [`backend/src/config.ts`](../backend/src/config.ts)
- Troubleshooting CORS runtime errors: [`docs/troubleshooting.md`](troubleshooting.md)
