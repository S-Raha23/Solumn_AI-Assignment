# Veriform webhooks (identity verification)

Veriform runs our identity checks. When a check finishes it sends `check.completed`:

```
POST /webhooks/veriform
Veriform-Signature: t=1794823200,v1=<hex hmac>
Content-Type: application/json
```

```json
{
  "id": "evt_8Qm2c7",
  "type": "check.completed",
  "created": 1794823200,
  "data": {
    "check": {
      "id": "chk_31Hx0a",
      "reference": "cus_1003",
      "result": "rejected",
      "completed_at": "2026-11-16T10:00:00Z",
      "reasons": [
        { "code": "DOC_EXPIRED", "message": "Passport 533401187 expired on 2025-04-30" }
      ],
      "applicant": {
        "full_name": "Daniel Okafor",
        "date_of_birth": "1991-07-22",
        "address": { "line1": "18 Grove Terrace", "city": "Leeds", "postcode": "LS6 2AB", "country": "GB" }
      },
      "document": { "type": "passport", "number": "533401187", "issuing_country": "GBR", "expiry": "2025-04-30" },
      "liveness": { "score": 0.94, "selfie_url": "https://files.veriform.example/s/chk_31Hx0a/selfie.jpg" }
    }
  }
}
```

- `reference` is the customer id we passed when we created the check.
- `result`: `clear` (passed), `consider` (needs a person to look), `rejected` (failed).
- `reasons` explains a `consider` or `rejected` result; empty for `clear`.
  Codes: `DOC_EXPIRED`, `DOC_UNREADABLE`, `DOC_TAMPERED`, `NAME_MISMATCH`, `DOB_MISMATCH`,
  `FACE_MISMATCH`, `LIVENESS_FAILED`, `WATCHLIST_HIT`.
- Other event types (`check.started`, `check.reminder`) may be sent; nothing needs to happen
  for them.
- Veriform retries non-2xx responses with backoff for 24 hours and may deliver events out of
  order.
