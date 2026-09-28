# Webhook Payload Reference

StellarKraal emits HTTP webhook callbacks whenever a loan changes state. This
guide documents the exact JSON shape for each event type, how to verify
delivery signatures, and how to decrypt encrypted payloads.

For architectural context — including registration endpoints, retry strategy,
and security model — see [ADR-008: Webhook-Based Event Delivery](../adr/ADR-008-webhooks.md).

---

## Envelope

Every webhook delivery is an HTTP `POST` with `Content-Type: application/json`.
The body always uses the following top-level envelope:

```json
{
  "event": "<event-type>",
  "payload": { ... },
  "timestamp": 1690000000000
}
```

| Field | Type | Description |
|-------|------|-------------|
| `event` | `string` | Event type identifier (see [Event types](#event-types)). |
| `payload` | `object` | Event-specific data (see per-event schemas below). |
| `timestamp` | `number` | Unix epoch **milliseconds** when the event was generated on the server. |

For webhooks registered with `encrypt: true`, the body uses a different
structure — see [Encrypted delivery](#encrypted-delivery).

---

## Event types

### `loan.approved`

Fired when a loan request transaction is built (in `loanService.requestLoan()`),
immediately before submission to the Soroban contract.

**JSON Schema**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "loan.approved payload",
  "type": "object",
  "required": ["borrower", "collateral_ids", "amount"],
  "additionalProperties": false,
  "properties": {
    "borrower": {
      "type": "string",
      "description": "Stellar public key (G...) of the borrowing account.",
      "pattern": "^G[A-Z2-7]{55}$"
    },
    "collateral_ids": {
      "type": "array",
      "description": "IDs of the collateral records pledged for this loan.",
      "items": { "type": "integer", "minimum": 0 },
      "minItems": 1
    },
    "amount": {
      "type": "integer",
      "description": "Loan amount in stroops (1 XLM = 10,000,000 stroops).",
      "minimum": 1
    }
  }
}
```

**Example payload**

```json
{
  "event": "loan.approved",
  "payload": {
    "borrower": "GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3TMVSWN7KV",
    "collateral_ids": [12, 17],
    "amount": 5000000000
  },
  "timestamp": 1690000000000
}
```

---

### `loan.repaid`

Fired when a repayment transaction is built (in `loanService.repayLoan()`).

**JSON Schema**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "loan.repaid payload",
  "type": "object",
  "required": ["borrower", "loan_id", "amount"],
  "additionalProperties": false,
  "properties": {
    "borrower": {
      "type": "string",
      "description": "Stellar public key of the account repaying the loan.",
      "pattern": "^G[A-Z2-7]{55}$"
    },
    "loan_id": {
      "type": "integer",
      "description": "Database ID of the loan being repaid.",
      "minimum": 0
    },
    "amount": {
      "type": "integer",
      "description": "Repayment amount in stroops.",
      "minimum": 1
    }
  }
}
```

**Example payload**

```json
{
  "event": "loan.repaid",
  "payload": {
    "borrower": "GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3TMVSWN7KV",
    "loan_id": 42,
    "amount": 5000000000
  },
  "timestamp": 1690003600000
}
```

---

### `loan.liquidated`

Fired when a liquidation transaction is built (in `loanService.liquidateLoan()`).

**JSON Schema**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "loan.liquidated payload",
  "type": "object",
  "required": ["liquidator", "loan_id", "repay_amount"],
  "additionalProperties": false,
  "properties": {
    "liquidator": {
      "type": "string",
      "description": "Stellar public key of the account performing the liquidation.",
      "pattern": "^G[A-Z2-7]{55}$"
    },
    "loan_id": {
      "type": "integer",
      "description": "Database ID of the liquidated loan.",
      "minimum": 0
    },
    "repay_amount": {
      "type": "integer",
      "description": "Amount repaid during liquidation in stroops.",
      "minimum": 1
    }
  }
}
```

**Example payload**

```json
{
  "event": "loan.liquidated",
  "payload": {
    "liquidator": "GBVZQ4TBTSNKZXJD5CKAHVTQNTLFKBHXNZENAPQVMQPF36KZOLKIIG4A",
    "loan_id": 42,
    "repay_amount": 4800000000
  },
  "timestamp": 1690007200000
}
```

---

### `loan.activated`

Fired by the contract event listener when the on-chain `loan_activated` event
is confirmed on Stellar. This event arrives **after** `loan.approved` once the
Soroban transaction is included in a ledger.

**JSON Schema**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "loan.activated payload",
  "type": "object",
  "required": ["loanId", "borrower", "amount", "timestamp"],
  "additionalProperties": false,
  "properties": {
    "loanId": {
      "type": "string",
      "description": "On-chain loan identifier as returned by the Soroban contract."
    },
    "borrower": {
      "type": "string",
      "description": "Stellar public key of the borrower.",
      "pattern": "^G[A-Z2-7]{55}$"
    },
    "amount": {
      "type": "integer",
      "description": "Activated loan amount in stroops.",
      "minimum": 1
    },
    "timestamp": {
      "type": "integer",
      "description": "Ledger close time as Unix epoch milliseconds."
    }
  }
}
```

**Example payload**

```json
{
  "event": "loan.activated",
  "payload": {
    "loanId": "loan-78a3f2",
    "borrower": "GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3TMVSWN7KV",
    "amount": 5000000000,
    "timestamp": 1690000120000
  },
  "timestamp": 1690000121500
}
```

> **Note:** `payload.timestamp` is the ledger close time; the top-level
> `timestamp` is when the webhook delivery was generated (slightly later).

---

## Signature verification

Every delivery includes an `X-StellarKraal-Signature` header:

```
X-StellarKraal-Signature: sha256=<hex>
```

The signature is HMAC-SHA256 of the **raw request body** (the JSON bytes as
received over the wire) using the per-webhook secret that was returned at
registration time.

### Verification steps

1. Read the raw request body as bytes — do **not** parse JSON first.
2. Compute `sha256=` + HMAC-SHA256 hex of the raw body using your webhook secret.
3. Compare using a **timing-safe equality function** to prevent timing attacks.
4. Reject the request if the signatures do not match.

### Node.js example

```js
import crypto from 'node:crypto';

/**
 * Verify the HMAC-SHA256 signature of an incoming webhook delivery.
 *
 * @param {Buffer} rawBody   - Raw request body (bytes, not parsed JSON).
 * @param {string} signature - Value of the X-StellarKraal-Signature header.
 * @param {string} secret    - Webhook secret returned at registration time.
 * @returns {boolean}        - true if the signature is valid.
 */
function verifySignature(rawBody, signature, secret) {
  if (!signature || !signature.startsWith('sha256=')) {
    // Missing or malformed header — reject immediately.
    return false;
  }

  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(rawBody)          // Buffer or string — must be the raw bytes
    .digest('hex');

  // Use timingSafeEqual to prevent timing side-channel attacks.
  // Both buffers must be the same length; if they differ the signature is
  // already invalid, but we still do the comparison to avoid leaking length
  // information via a short-circuit.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);

  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Reject webhook deliveries whose timestamp is older than the allowed window.
 * This prevents replay attacks where an attacker re-delivers a captured
 * (valid) payload at a later time.
 *
 * @param {number} timestamp     - Top-level `timestamp` field from the webhook body (ms).
 * @param {number} maxAgeMs      - Maximum acceptable age in milliseconds (default: 5 minutes).
 * @returns {boolean}            - true if the timestamp is within the allowed window.
 */
function isTimestampFresh(timestamp, maxAgeMs = 5 * 60 * 1000) {
  const now = Date.now();
  const age = Math.abs(now - timestamp);
  return age <= maxAgeMs;
}

// Express handler example
import express from 'express';
const app = express();

app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['x-stellarkraal-signature'];

  // 1. Check that the header is present.
  if (!sig) {
    console.warn('Webhook rejected: missing X-StellarKraal-Signature header');
    return res.status(400).send('Missing signature header');
  }

  // 2. Verify the HMAC signature.
  if (!verifySignature(req.body, sig, process.env.WEBHOOK_SECRET)) {
    console.warn('Webhook rejected: invalid signature');
    return res.status(401).send('Invalid signature');
  }

  // 3. Parse the body and check the timestamp to prevent replay attacks.
  const event = JSON.parse(req.body);

  if (!isTimestampFresh(event.timestamp)) {
    console.warn(`Webhook rejected: stale timestamp (${event.timestamp})`);
    return res.status(400).send('Stale webhook — possible replay attack');
  }

  // 4. Process the event.
  console.log(`Received event: ${event.event}`);
  // ... handle event.payload ...

  res.status(200).send('OK');
});
```

> **Important:** Use `express.raw()` (not `express.json()`) so the body is
> available as a raw `Buffer` before JSON parsing.

#### Edge cases (Node.js)

| Scenario | Behaviour |
|----------|-----------|
| `X-StellarKraal-Signature` header missing | `verifySignature` returns `false` immediately; handler returns `400`. |
| Header present but does not start with `sha256=` | `verifySignature` returns `false`; handler returns `401`. |
| Valid signature but replayed event (old timestamp) | Signature check passes; `isTimestampFresh` returns `false`; handler returns `400`. |
| Tampered body | HMAC mismatch; `verifySignature` returns `false`; handler returns `401`. |
| Secret rotated after delivery | HMAC mismatch; the old secret no longer produces the same digest. Re-register the webhook if you rotate the secret. |

### Python example

```python
import hashlib
import hmac
import time
import json

def verify_signature(raw_body: bytes, signature: str, secret: str) -> bool:
    """
    Verify the HMAC-SHA256 signature of an incoming webhook delivery.

    Args:
        raw_body:  Raw request body bytes (before JSON parsing).
        signature: Value of the X-StellarKraal-Signature header.
        secret:    Webhook secret returned at registration time.

    Returns:
        True if the signature is valid, False otherwise.
    """
    if not signature or not signature.startswith('sha256='):
        # Missing or malformed header — reject immediately.
        return False

    expected = 'sha256=' + hmac.new(
        secret.encode('utf-8'),
        raw_body,
        hashlib.sha256
    ).hexdigest()

    # hmac.compare_digest is constant-time — prevents timing side-channel attacks.
    return hmac.compare_digest(signature, expected)


def is_timestamp_fresh(timestamp_ms: int, max_age_ms: int = 5 * 60 * 1000) -> bool:
    """
    Reject deliveries whose timestamp is older than the allowed window.

    Args:
        timestamp_ms: Top-level `timestamp` field from the webhook body (milliseconds).
        max_age_ms:   Maximum acceptable age in milliseconds (default: 5 minutes).

    Returns:
        True if the timestamp is within the allowed window.
    """
    now_ms = int(time.time() * 1000)
    return abs(now_ms - timestamp_ms) <= max_age_ms


# Flask handler example
from flask import Flask, request, abort

app = Flask(__name__)
WEBHOOK_SECRET = "your-webhook-secret"  # load from environment in production

@app.route('/webhook', methods=['POST'])
def webhook():
    sig = request.headers.get('X-StellarKraal-Signature', '')

    # 1. Check that the header is present.
    if not sig:
        app.logger.warning('Webhook rejected: missing X-StellarKraal-Signature header')
        abort(400, description='Missing signature header')

    raw_body = request.get_data()

    # 2. Verify the HMAC signature.
    if not verify_signature(raw_body, sig, WEBHOOK_SECRET):
        app.logger.warning('Webhook rejected: invalid signature')
        abort(401, description='Invalid signature')

    # 3. Parse the body and check the timestamp to prevent replay attacks.
    event = json.loads(raw_body)

    if not is_timestamp_fresh(event.get('timestamp', 0)):
        app.logger.warning(f"Webhook rejected: stale timestamp ({event.get('timestamp')})")
        abort(400, description='Stale webhook — possible replay attack')

    # 4. Process the event.
    app.logger.info(f"Received event: {event['event']}")
    # ... handle event['payload'] ...

    return 'OK', 200
```

#### Edge cases (Python)

| Scenario | Behaviour |
|----------|-----------|
| `X-StellarKraal-Signature` header missing | `verify_signature` returns `False` immediately; handler returns `400`. |
| Header present but does not start with `sha256=` | `verify_signature` returns `False`; handler returns `401`. |
| Valid signature but replayed event (old timestamp) | Signature check passes; `is_timestamp_fresh` returns `False`; handler returns `400`. |
| Tampered body | HMAC mismatch; `verify_signature` returns `False`; handler returns `401`. |
| Encoding mismatch | Always pass `raw_body` as `bytes` (not a decoded string) to avoid digest mismatches caused by different UTF-8 normalisation. |

### Replay attack prevention

Even a perfectly valid signature can be replayed by an attacker who captured
a previous delivery. To defend against this:

1. **Check the `timestamp` field** in every delivery (as shown above). Reject
   events older than 5 minutes. This window is a trade-off: too small and
   slow networks cause false rejections; too large and replays become
   practical.

2. **Use HTTPS** for your webhook endpoint so deliveries cannot be intercepted
   in transit.

3. **Optionally track delivery IDs** — if your system requires absolute
   idempotency, store the webhook event key (`event` + `timestamp`) in a
   short-lived cache (e.g., Redis TTL of 10 minutes) and reject duplicates.

---

## Encrypted delivery

Webhooks registered with `encrypt: true` receive an encrypted body instead of
a plain `payload`. The encryption key is derived from your webhook secret using
HKDF-SHA256 and the plaintext is encrypted with AES-256-GCM.

**Encrypted envelope structure**

```json
{
  "event": "loan.approved",
  "encrypted_payload": "a3f2...",
  "iv": "9b1c...",
  "auth_tag": "d4e5...",
  "timestamp": 1690000000000
}
```

| Field | Type | Description |
|-------|------|-------------|
| `encrypted_payload` | `string` | Hex-encoded AES-256-GCM ciphertext of the JSON payload. |
| `iv` | `string` | Hex-encoded 12-byte initialisation vector. |
| `auth_tag` | `string` | Hex-encoded 16-byte GCM authentication tag. |

The `X-StellarKraal-Signature` header is still present and covers the entire
encrypted envelope body — verify it before attempting decryption.

**Decryption — Node.js**

```js
import crypto from 'node:crypto';

function deriveKey(secret) {
  return crypto.hkdfSync(
    'sha256',
    Buffer.from(secret, 'utf8'),
    Buffer.alloc(0),                                        // empty salt
    Buffer.from('stellarkraal-webhook-encryption', 'utf8'), // info
    32                                                      // 32-byte AES-256 key
  );
}

function decryptPayload(encryptedPayload, iv, authTag, secret) {
  const key    = Buffer.from(deriveKey(secret));
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(iv, 'hex')
  );
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(encryptedPayload, 'hex')),
    decipher.final(),
  ]);
  return JSON.parse(plain.toString('utf8'));
}

// Usage:
const { encrypted_payload, iv, auth_tag } = body;
const payload = decryptPayload(encrypted_payload, iv, auth_tag, WEBHOOK_SECRET);
```

---

## Registering a webhook

```http
POST /api/v1/webhooks
Content-Type: application/json

{
  "url": "https://your-server.example.com/hooks/stellarkraal",
  "encrypt": false
}
```

**Response (201 Created)**

```json
{
  "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "url": "https://your-server.example.com/hooks/stellarkraal",
  "secret": "a1b2c3d4...",
  "createdAt": 1690000000000
}
```

> **Store the `secret` immediately.** It is returned only once and cannot be
> retrieved later. If you lose it, delete the webhook and register a new one.

---

## Delivery and retry

- Maximum **5 delivery attempts** per event.
- Exponential backoff: 1 s, 2 s, 4 s, 8 s, 16 s between retries.
- Your endpoint should return `2xx` within a reasonable timeout. Non-`2xx`
  responses and network errors are both treated as failures.
- After 5 failed attempts the event is abandoned. Use the `/api/v1/admin/webhooks/logs`
  endpoint to inspect failed deliveries.

---

## Security checklist

- [ ] Verify `X-StellarKraal-Signature` on every request using a timing-safe comparison.
- [ ] Store your webhook secret in an environment variable or secret manager — never commit it to source control.
- [ ] Respond quickly (< 5 s) and process the event asynchronously to avoid delivery timeouts.
- [ ] Use `timestamp` to detect and discard replayed or stale events.
- [ ] Register with `encrypt: true` when transmitting over untrusted networks.

---

## Related documentation

- [ADR-008: Webhook-Based Event Delivery](../adr/ADR-008-webhooks.md) — architecture, retry strategy, security model
- [API Integration Tutorial](api-integration-tutorial.md) — end-to-end example using webhooks to monitor loan status
- [API Quickstart](api-quickstart.md) — authentication and base URL
