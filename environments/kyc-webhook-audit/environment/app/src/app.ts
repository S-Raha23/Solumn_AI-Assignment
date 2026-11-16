import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CustomerStore, UnknownCustomer, dataDir } from "./customers.ts";
import { paylarkWebhook } from "./webhooks/paylark.ts";

export type Request = {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  body: Buffer;
};

export type Response = { status: number; body: unknown };

export type Context = {
  now: Date;
  dataDir: string;
  secrets: Record<string, string>;
};

export type Handler = (req: Request, ctx: Context) => Response;

/** Webhook signing secrets, from config/secrets.json (mounted from the vault in production). */
export function loadSecrets(dir = join(import.meta.dirname, "..", "config")): Record<string, string> {
  return JSON.parse(readFileSync(join(dir, "secrets.json"), "utf8"));
}

const customerView: Handler = (req, ctx) => {
  const id = req.path.split("/")[3] ?? "";
  try {
    const c = new CustomerStore(ctx.dataDir).get(id);
    return { status: 200, body: { id: c.id, kyc_status: c.kyc_status, kyc_updated_at: c.kyc_updated_at } };
  } catch (err) {
    if (err instanceof UnknownCustomer) return { status: 404, body: { error: err.message } };
    throw err;
  }
};

const routes: Array<{ method: string; pattern: RegExp; handler: Handler }> = [
  { method: "GET", pattern: /^\/healthz$/, handler: () => ({ status: 200, body: { ok: true } }) },
  { method: "GET", pattern: /^\/internal\/customers\/[^/]+$/, handler: customerView },
  { method: "POST", pattern: /^\/webhooks\/paylark$/, handler: paylarkWebhook },
];

/** Routes one request. Normalises header names to lower case first. */
export function handle(req: Request, ctx: Partial<Context> = {}): Response {
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = v;
  const full: Context = {
    now: ctx.now ?? new Date(),
    dataDir: ctx.dataDir ?? dataDir(),
    secrets: ctx.secrets ?? loadSecrets(),
  };
  const route = routes.find((r) => r.method === req.method && r.pattern.test(req.path));
  if (!route) return { status: 404, body: { error: "not found" } };
  try {
    return route.handler({ ...req, headers }, full);
  } catch (err) {
    if (err instanceof SyntaxError) return { status: 400, body: { error: "invalid JSON" } };
    throw err;
  }
}
