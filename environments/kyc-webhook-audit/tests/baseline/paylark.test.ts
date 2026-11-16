import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handle } from "../src/app.ts";
import { sign, verify, SignatureError } from "../src/signature.ts";

const ROOT = join(import.meta.dirname, "..");
const SECRETS = { paylark: "whsec_test_paylark", veriform: "whsec_test_veriform" };
const NOW = new Date("2026-11-16T10:00:00Z");
const T = Math.floor(NOW.getTime() / 1000);

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "pocketwise-"));
  cpSync(join(ROOT, "data"), dir, { recursive: true });
  process.env.AUDIT_LOG = join(dir, "audit.ndjson");
  return dir;
}

function paylark(dir: string, event: object, secret = SECRETS.paylark, t = T) {
  const body = Buffer.from(JSON.stringify(event));
  return handle(
    { method: "POST", path: "/webhooks/paylark", headers: { "Paylark-Signature": `t=${t},v1=${sign(secret, t, body)}` }, body },
    { now: NOW, dataDir: dir, secrets: SECRETS },
  );
}

const settled = { id: "evt_p1", type: "payment.settled", data: { customer: "cus_1001", amount_minor: 2500, currency: "GBP", payment_id: "pay_1" } };

test("verify accepts a good signature and rejects tampering and stale timestamps", () => {
  const body = Buffer.from("{}");
  verify("s", `t=${T},v1=${sign("s", T, body)}`, body, NOW);
  assert.throws(() => verify("s", `t=${T},v1=${sign("s", T, "{ }")}`, body, NOW), SignatureError);
  assert.throws(() => verify("s", `t=${T - 900},v1=${sign("s", T - 900, body)}`, body, NOW), SignatureError);
  assert.throws(() => verify("s", undefined, body, NOW), SignatureError);
});

test("settled payment credits the balance once and is audited", () => {
  const dir = scratch();
  assert.equal(paylark(dir, settled).status, 200);
  assert.deepEqual(paylark(dir, settled).body, { duplicate: true });
  const customers = JSON.parse(readFileSync(join(dir, "customers.json"), "utf8"));
  assert.equal(customers.find((c: { id: string }) => c.id === "cus_1001").balance_minor, 12500);
  const audit = readFileSync(process.env.AUDIT_LOG!, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(audit.length, 1);
  assert.equal(audit[0].type, "paylark.payment.settled");
});

test("bad signature, unknown customer and unknown route", () => {
  const dir = scratch();
  assert.equal(paylark(dir, settled, "wrong").status, 401);
  assert.equal(paylark(dir, { ...settled, data: { ...settled.data, customer: "cus_9" } }).status, 404);
  const res = handle({ method: "GET", path: "/nope", headers: {}, body: Buffer.alloc(0) }, { now: NOW, dataDir: dir, secrets: SECRETS });
  assert.equal(res.status, 404);
});

test("customer view shows KYC status only", () => {
  const dir = scratch();
  const res = handle({ method: "GET", path: "/internal/customers/cus_1002", headers: {}, body: Buffer.alloc(0) }, { now: NOW, dataDir: dir, secrets: SECRETS });
  assert.deepEqual(res.body, { id: "cus_1002", kyc_status: "pending_kyc", kyc_updated_at: null });
});
