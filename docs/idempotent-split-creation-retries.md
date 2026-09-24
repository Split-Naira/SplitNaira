# Idempotent Split Creation Retries

Guide for API consumers safely retrying `POST /splits` requests.

## Idempotency-Key

Send a unique `Idempotency-Key` header (UUID recommended) with every create-split request.

- The key is scoped per endpoint + client, valid for **24 hours**.
- Retrying with the **same key and same payload** returns the original response (same status code), no new split is created.
- Retrying with the **same key and a different payload** returns `409 Conflict` with code `IDEMPOTENCY_KEY_CONFLICT`. The key is already bound to a different request.
  - "Payload" means the method, full URL (path params and query string), and JSON body.
  - Object key order is ignored. Array order, value types (`1` vs `"1"`), and `null` vs a missing field all count as differences.
  - A conflicting attempt never replaces the stored response. Retrying with the original payload still replays it.
- Retrying with the **same key while the first request is still running** returns `409` with code `IDEMPOTENCY_KEY_IN_PROGRESS`. If the payload also differs, `IDEMPOTENCY_KEY_CONFLICT` is returned instead.
- Only `2xx` responses are stored. If the first attempt fails (for example with `400`), the key is released and can be reused with a corrected payload.
- After the TTL expires, the key can be reused for a new request.

## Examples

**Success then replay (safe retry):**
```
POST /splits  Idempotency-Key: 3f9e...  -> 200 OK {"xdr": "AAAA...", ...}
POST /splits  Idempotency-Key: 3f9e...  -> 200 OK {"xdr": "AAAA...", ...}  # same body, Idempotency-Replayed: true
```

**Payload mismatch:**
```
POST /splits  Idempotency-Key: 3f9e...  body A -> 200 OK
POST /splits  Idempotency-Key: 3f9e...  body B -> 409 Conflict
  {"error": "idempotency_key_conflict", "code": "IDEMPOTENCY_KEY_CONFLICT",
   "message": "Idempotency-Key was already used with a different request payload.",
   "requestId": "...", "details": {}}
```

## Recommendation

Generate one key per logical create-split attempt in your client and reuse it for all network retries of that attempt.
