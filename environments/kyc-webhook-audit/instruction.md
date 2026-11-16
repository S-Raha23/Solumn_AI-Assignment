# PW-519: handle Veriform identity-check webhooks

`/app` is the Pocketwise API (TypeScript, Node 22; `docs/operations.md`). New customers are
checked by Veriform, our identity-verification provider, but nothing receives Veriform's result
yet: customers sit in `pending_kyc` until someone in Risk updates them by hand. Veriform's
webhook format is in `docs/veriform.md`, and `samples/` has two captures from their sandbox.

Add `POST /webhooks/veriform`, implemented in `src/webhooks/veriform.ts` and registered in
`src/app.ts`.

1. Verify `Veriform-Signature` with the `veriform` secret, the same way the Paylark webhook
   does. Bad or stale signature: 401. Body that is not JSON: 400. Unknown customer
   (`reference`): 404. Nothing is changed or recorded in any of those cases.
2. `check.completed` sets the customer's `kyc_status` from `result`: `clear` -> `verified`,
   `consider` -> `manual_review`, `rejected` -> `rejected`. Also set `kyc_check_id` to the check
   id and `kyc_updated_at` to the check's `completed_at`. Answer 200 once saved.
3. Answer 200 without changing anything when: the event id was already handled; the event is
   not `check.completed`; the transition is not allowed by `canMove`; or the check completed
   before the customer's current `kyc_updated_at` (Veriform delivers out of order).
4. Every decision that changes a customer gets one audit-trail entry of type `kyc.decision`,
   actor `veriform`, subject the customer id, at the request time. Support need to be able to
   answer "why was my account approved / sent for review / rejected?" from the audit trail alone,
   without opening the Veriform dashboard, so the entry must carry the check id, the result, the
   new status and, for every reason Veriform gave, its code and Veriform's explanation of it
   (Support read the explanation back to the customer).
5. Add tests (`npm test`). The Paylark webhook, the customer view and the existing tests must
   keep working as they do now.

You can try it with `node src/server.ts replay samples/<file> --now <ISO time>`.
