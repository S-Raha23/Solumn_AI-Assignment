import { record } from "../audit.ts";
import { CustomerStore } from "../customers.ts";
import { SignatureError, verify } from "../signature.ts";
import type { Handler } from "../app.ts";

type PaylarkEvent = {
  id: string;
  type: "payment.settled" | "payment.refunded" | string;
  data: { customer: string; amount_minor: number; currency: string; payment_id: string };
};

/**
 * Paylark, our card acquirer, tells us when a top-up settles or is refunded.
 * Paylark retries any non-2xx response for up to three days.
 */
export const paylarkWebhook: Handler = (req, ctx) => {
  try {
    verify(ctx.secrets.paylark, req.headers["paylark-signature"], req.body, ctx.now);
  } catch (err) {
    if (err instanceof SignatureError) return { status: 401, body: { error: err.message } };
    throw err;
  }
  const event = JSON.parse(req.body.toString("utf8")) as PaylarkEvent;
  const store = new CustomerStore(ctx.dataDir);
  if (!store.has(event.data.customer)) return { status: 404, body: { error: "unknown customer" } };
  const customer = store.get(event.data.customer);
  if (customer.processed_events.includes(event.id)) return { status: 200, body: { duplicate: true } };

  if (event.type === "payment.settled") customer.balance_minor += event.data.amount_minor;
  else if (event.type === "payment.refunded") customer.balance_minor -= event.data.amount_minor;
  else return { status: 200, body: { ignored: event.type } };

  store.markProcessed(customer, event.id);
  store.save();
  record(`paylark.${event.type}`, {
    actor: "paylark",
    subject: customer.id,
    details: { event_id: event.id, balance_minor: customer.balance_minor, event },
    at: ctx.now,
  });
  return { status: 200, body: { ok: true } };
};
