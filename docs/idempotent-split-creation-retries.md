# Idempotent Split Creation Retries

Guide for API consumers safely retrying `POST /splits` requests.

## Idempotency-Key

Send a unique `Idempotency-Key` header (UUID recommended) with every create-split request.

- The key is scoped per endpoint + client, valid for **24 hours**.
- Retrying with the **same key and same payload** returns the original response (same status code), no new split is created.
- Retrying with the **same key and a different payload** returns `409 Conflict` — the key is already bound to a different request body.
- After the TTL expires, the key can be reused for a new request.

## Examples

**Success then replay (safe retry):**
```
POST /splits  Idempotency-Key: 3f9e...  -> 201 Created {"id": "split_123", ...}
POST /splits  Idempotency-Key: 3f9e...  -> 201 Created {"id": "split_123", ...}  # same body returned, no duplicate
```

**Payload mismatch:**
```
POST /splits  Idempotency-Key: 3f9e...  body A -> 201 Created
POST /splits  Idempotency-Key: 3f9e...  body B -> 409 Conflict {"error": "idempotency_key_payload_mismatch"}
```

## Recommendation

Generate one key per logical create-split attempt in your client and reuse it for all network retries of that attempt.
