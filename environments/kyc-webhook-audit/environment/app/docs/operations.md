# Pocketwise API: operations

TypeScript on Node 22, run with type stripping (no build step):

```
node src/server.ts                                   # listen on $PORT
node src/server.ts replay samples/<file>.json --now 2026-11-16T10:00:00Z
npm test
```

`replay` pushes one captured request through the router, which is how we debug webhook
deliveries. Everything under `samples/` is a capture from the providers' sandboxes.

## State

Customers live in `$APP_DATA/customers.json` (default `data/`). `kyc_status` moves
`pending_kyc -> manual_review | verified | rejected`; `manual_review -> verified | rejected`
(see `src/customers.ts`). A customer cannot add money or send payments until `verified`.
`processed_events` holds the last 50 provider event ids, so a redelivered webhook is a no-op.

## Webhooks

| Route | Provider | Secret (`config/secrets.json`) | Header |
| --- | --- | --- | --- |
| `POST /webhooks/paylark` | Paylark (card top-ups) | `paylark` | `Paylark-Signature` |

Both providers sign `"<t>.<raw body>"` with HMAC-SHA256 (`src/signature.ts`) and retry any
non-2xx response, so handlers must be idempotent and must answer 2xx only once the change is
saved. Answer 401 for a bad or stale signature, 404 for an unknown customer, 400 for a body
that is not JSON.

## Audit trail

`src/audit.ts` appends one JSON line per business event to `$AUDIT_LOG`
(default `/var/tmp/audit/audit.ndjson`). The log shipper tails that file into Logline, where it
is kept for 400 days and is searchable by everyone in Engineering, Support and Risk
(about 140 people). Support use it to answer "what happened to my account?" tickets.
