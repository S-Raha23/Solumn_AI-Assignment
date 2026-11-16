import { record } from "../audit.ts";
import { CustomerStore, canMove } from "../customers.ts";
import type { KycStatus } from "../customers.ts";
import { SignatureError, verify } from "../signature.ts";
import type { Handler } from "../app.ts";

type VeriformReason = { code: string; message?: string };

type VeriformEvent = {
  id: string;
  type: string;
  created: number;
  data: {
    check: {
      id: string;
      reference: string;
      result: "clear" | "consider" | "rejected";
      completed_at: string;
      reasons?: VeriformReason[];
      document?: { number?: string };
    };
  };
};

const STATUS: Record<string, KycStatus> = { clear: "verified", consider: "manual_review", rejected: "rejected" };

/**
 * Veriform's explanation of a reason, without the applicant's document number.
 * Explanations such as "Passport 533401187 expired on ..." quote it, and the
 * audit trail is searchable by ~140 people for 400 days; Support need the
 * explanation, not the number.
 */
function explain(reason: VeriformReason, documentNumber: string | undefined): string {
  let text = reason.message ?? "";
  if (documentNumber && documentNumber.length >= 4) text = text.split(documentNumber).join("[document number]");
  return text;
}

/**
 * Veriform identity-check results. The payload also carries the applicant's
 * identity (name, date of birth, address, document number, selfie link); none
 * of it is stored or audited here. The check id leads to the full record in
 * Veriform for the few people who need it.
 */
export const veriformWebhook: Handler = (req, ctx) => {
  try {
    verify(ctx.secrets.veriform, req.headers["veriform-signature"], req.body, ctx.now);
  } catch (err) {
    if (err instanceof SignatureError) return { status: 401, body: { error: err.message } };
    throw err;
  }
  const event = JSON.parse(req.body.toString("utf8")) as VeriformEvent;
  if (event.type !== "check.completed") return { status: 200, body: { ignored: event.type } };

  const check = event.data.check;
  const store = new CustomerStore(ctx.dataDir);
  if (!store.has(check.reference)) return { status: 404, body: { error: "unknown customer" } };
  const customer = store.get(check.reference);
  if (customer.processed_events.includes(event.id)) return { status: 200, body: { duplicate: true } };

  const next = STATUS[check.result];
  const stale = customer.kyc_updated_at !== null && Date.parse(check.completed_at) < Date.parse(customer.kyc_updated_at);
  if (!next || stale || !canMove(customer.kyc_status, next)) {
    return { status: 200, body: { ignored: "no change" } };
  }

  const previous = customer.kyc_status;
  customer.kyc_status = next;
  customer.kyc_check_id = check.id;
  customer.kyc_updated_at = check.completed_at;
  store.markProcessed(customer, event.id);
  store.save();

  record("kyc.decision", {
    actor: "veriform",
    subject: customer.id,
    details: {
      event_id: event.id,
      check_id: check.id,
      result: check.result,
      previous_status: previous,
      status: next,
      reasons: (check.reasons ?? []).map((r) => ({ code: r.code, explanation: explain(r, check.document?.number) })),
    },
    at: ctx.now,
  });
  return { status: 200, body: { ok: true, status: next } };
};
