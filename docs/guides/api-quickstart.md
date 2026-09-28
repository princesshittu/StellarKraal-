# Backend API Quickstart

StellarKraal exposes a versioned REST API for livestock-backed lending on Stellar/Soroban.
This guide takes you from zero to your first successful API call in under ten minutes.

## Base URLs

| Environment | Base URL |
|-------------|----------|
| Local development | `http://localhost:3001` |
| Staging | `https://api-staging.stellarkraal.example.com` |

All examples below use `http://localhost:3001`. Replace with the staging URL when testing against
the hosted environment.

The versioned path prefix is `/api/v1`. New integrations should always use the versioned prefix.

The interactive OpenAPI / Swagger UI is served at:

- Local: `http://localhost:3001/api/docs`
- Full spec source: [`backend/openapi.json`](../../backend/openapi.json)

---

## Step 1 — Obtain a JWT

The API uses a wallet-based challenge–sign–login flow. You need a Stellar key pair and a
signature tool (`stellar-cli` or Freighter) to complete it. For a visual overview of the full
flow — including token refresh and logout — see the
[Authentication Flow Diagram](../auth-flow.md#authentication-flow-diagram).

### 1a. Fetch a one-time challenge

```bash
curl http://localhost:3001/auth/challenge
```

Response:

```json
{ "challenge": "stellarkraal:1721900000000:abc123def456" }
```

### 1b. Sign the challenge

Sign the raw challenge bytes with your Stellar secret key. Using `stellar-cli`:

```bash
# Store the challenge in a variable
CHALLENGE=$(curl -s http://localhost:3001/auth/challenge | jq -r '.challenge')

# Sign it (replace S... with your secret key)
SIGNATURE=$(echo -n "$CHALLENGE" | stellar keys sign --key <YOUR_SECRET_KEY> --stdin)
```

### 1c. Exchange for tokens

```bash
curl -s -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d "{
    \"publicKey\": \"GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN\",
    \"signature\": \"$SIGNATURE\",
    \"challenge\": \"$CHALLENGE\"
  }"
```

Response:

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiJ9...",
  "expiresIn": 900
}
```

- `accessToken` is valid for **15 minutes**. Pass it as `Authorization: Bearer <token>` on every
  protected request.
- `refreshToken` is valid for **7 days**. Use `POST /auth/refresh` to obtain a fresh pair before
  the access token expires.

Store the token:

```bash
TOKEN="eyJhbGciOiJIUzI1NiJ9..."
```

---

## Step 2 — List Collaterals

Retrieve collateral records owned by your account. This endpoint is paginated.

```bash
curl -s "http://localhost:3001/api/v1/collateral?page=1&pageSize=10" \
  -H "Authorization: Bearer $TOKEN"
```

Response:

```json
{
  "data": [
    {
      "id": "1",
      "owner": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
      "animal_type": "cattle",
      "count": 5,
      "appraised_value": 5000000,
      "deleted_at": null
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 10
}
```

---

## Step 3 — Register Collateral

Register livestock as collateral. The endpoint returns an **unsigned XDR transaction** that your
wallet must sign and submit to the Stellar network.

```bash
curl -s -X POST http://localhost:3001/api/v1/collateral/register \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "owner": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "animal_type": "cattle",
    "count": 5,
    "appraised_value": 5000000
  }'
```

Response:

```json
{
  "xdr": "AAAAAgAAAAA...",
  "collateral_id": 42
}
```

Sign and submit the XDR using `stellar-cli`:

```bash
stellar transaction sign --xdr "AAAAAgAAAAA..." --source <YOUR_SECRET_KEY> --network testnet
stellar transaction submit --xdr "<SIGNED_XDR>" --network testnet
```

In a browser context, use Freighter — see the
[Freighter Integration Guide](./freighter-integration.md) for details.

**Request fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `owner` | string | ✓ | Stellar public key (G…) of the collateral owner |
| `animal_type` | string | ✓ | Type of livestock: `cattle`, `goat`, `sheep`, etc. |
| `count` | integer | ✓ | Number of animals in this collateral group |
| `appraised_value` | integer | ✓ | Total appraised value in token base units |

---

## Step 4 — Request a Loan

Request a loan against a registered collateral ID.

```bash
curl -s -X POST http://localhost:3001/api/v1/loan/request \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "borrower": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "collateral_id": 42,
    "amount": 3000000
  }'
```

Response:

```json
{
  "xdr": "AAAAAgAAAAA...",
  "loan_id": 7
}
```

Sign and submit the returned XDR as shown in Step 3. Once confirmed on-chain, the loan state
transitions to `Active`.

**Request fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `borrower` | string | ✓ | Stellar public key of the borrower |
| `collateral_id` | integer | ✓ | ID returned from the collateral registration step |
| `amount` | integer | ✓ | Gross loan amount in token base units |

---

## Step 5 — Monitor Loan Status

```bash
# Fetch a specific loan
curl -s "http://localhost:3001/api/v1/loan/7" \
  -H "Authorization: Bearer $TOKEN"

# Check the health factor
curl -s "http://localhost:3001/api/v1/health/7" \
  -H "Authorization: Bearer $TOKEN"
```

A health factor below `1.0` puts the loan `at_risk`. See the
[Loan State Machine](../protocol/loan-state-machine.md) and
[Liquidation Mechanism](../protocol/liquidation.md) for details.

---

## Refreshing a Token

```bash
curl -s -X POST http://localhost:3001/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{ "refreshToken": "<YOUR_REFRESH_TOKEN>" }'
```

---

## Error Responses

All error responses follow a consistent JSON envelope:

```json
{ "error": "UNAUTHORIZED", "message": "Token expired or invalid." }
```

HTTP status codes follow standard conventions: `400` validation error, `401` unauthenticated,
`403` forbidden, `404` not found, `429` rate limited, `500` server error.

Full error code reference: [API Error Codes](../api-error-codes.md).

---

## Rate Limits

All clients are subject to per-IP rate limits. Retry using the `Retry-After` header value when
you receive a `429` response. Full details: [Rate Limits Guide](./rate-limits.md).

---

## Further Reading

| Resource | Description |
|----------|-------------|
| [OpenAPI Spec](../../backend/openapi.json) | Machine-readable full API specification |
| [Swagger UI](http://localhost:3001/api/docs) | Interactive API explorer (local only) |
| [Auth Flow](../auth-flow.md) | Detailed challenge–sign–login flow and token rotation |
| [API Integration Tutorial](./api-integration-tutorial.md) | End-to-end external app integration with webhooks |
| [Rate Limits](./rate-limits.md) | Per-tier limits, headers, and retry behaviour |
| [Freighter Integration](./freighter-integration.md) | Signing XDR with the Freighter browser extension |
| [Local Setup](../development/local-setup.md) | Full local development environment setup |
| [Troubleshooting](../troubleshooting.md) | Common errors and resolutions |
