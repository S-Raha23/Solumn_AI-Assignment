import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handle } from "../src/app.ts";
import { sign } from "../src/signature.ts";

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

function deliver(dir: string, event: object, secret = SECRETS.veriform) {
  const body = Buffer.from(JSON.stringify(event));
  return handle(
    { method: "POST", path: "/webhooks/veriform", headers: { "Veriform-Signature": `t=${T},v1=${sign(secret, T, body)}` }, body },
    { now: NOW, dataDir: dir, secrets: SECRETS },
  );
}

function customer(dir: string, id: string) {
  return JSON.parse(readFileSync(join(dir, "customers.json"), "utf8")).find((c: { id: string }) => c.id === id);
}

function audit() {
  const file = process.env.AUDIT_LOG!;
  return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
}

const event = (id: string, reference: string, result: string, completed_at: string, reasons: object[] = []) => ({
  id, type: "check.completed", created: T,
  data: { check: { id: `chk_${id}`, reference, result, completed_at, reasons,
    applicant: { full_name: "Test Person", date_of_birth: "1990-01-01" },
    document: { type: "passport", number: "PZ9911223", issuing_country: "GBR", expiry: "2030-01-01" } } },
});

test("clear check verifies the customer and audits the decision", () => {
  const dir = scratch();
  assert.equal(deliver(dir, event("e1", "cus_1002", "clear", "2026-11-16T09:59:00Z")).status, 200);
  const c = customer(dir, "cus_1002");
  assert.equal(c.kyc_status, "verified");
  assert.equal(c.kyc_check_id, "chk_e1");
  const [entry] = audit();
  assert.equal(entry.type, "kyc.decision");
  assert.equal(entry.details.status, "verified");
});

test("rejection audit carries reasons and explanations but no identity data", () => {
  const dir = scratch();
  deliver(dir, event("e2", "cus_1003", "rejected", "2026-11-16T09:59:00Z",
    [{ code: "DOC_EXPIRED", message: "Passport PZ9911223 expired on 2025-04-30" }]));
  const raw = readFileSync(process.env.AUDIT_LOG!, "utf8");
  assert.deepEqual(audit()[0].details.reasons, [{ code: "DOC_EXPIRED", explanation: "Passport [document number] expired on 2025-04-30" }]);
  assert.ok(!raw.includes("PZ9911223"));
  assert.ok(!raw.includes("1990-01-01"));
});

test("duplicates, stale and disallowed transitions change nothing", () => {
  const dir = scratch();
  const first = event("e3", "cus_1004", "clear", "2026-11-16T09:00:00Z");
  deliver(dir, first);
  assert.deepEqual(deliver(dir, first).body, { duplicate: true });
  deliver(dir, event("e4", "cus_1004", "rejected", "2026-11-16T08:00:00Z"));
  deliver(dir, event("e5", "cus_1005", "clear", "2026-11-16T09:00:00Z"));
  assert.equal(customer(dir, "cus_1004").kyc_status, "verified");
  assert.equal(customer(dir, "cus_1005").kyc_status, "rejected");
  assert.equal(audit().length, 1);
});

test("signature, JSON and unknown customer errors", () => {
  const dir = scratch();
  assert.equal(deliver(dir, event("e6", "cus_1002", "clear", "2026-11-16T09:00:00Z"), "wrong").status, 401);
  assert.equal(deliver(dir, event("e7", "cus_404", "clear", "2026-11-16T09:00:00Z")).status, 404);
  const body = Buffer.from("not json");
  const res = handle(
    { method: "POST", path: "/webhooks/veriform", headers: { "Veriform-Signature": `t=${T},v1=${sign(SECRETS.veriform, T, body)}` }, body },
    { now: NOW, dataDir: dir, secrets: SECRETS },
  );
  assert.equal(res.status, 400);
  assert.equal(audit().length, 0);
});
