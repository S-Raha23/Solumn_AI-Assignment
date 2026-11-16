'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runJob } = require('../src/runner');
const { readOplog } = require('../src/oplog');
const { fingerprintOf } = require('../src/reporter');

const REPO = path.resolve(__dirname, '..');

function scratch() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'incident-'));
  fs.cpSync(path.join(REPO, 'config'), path.join(root, 'config'), { recursive: true });
  fs.cpSync(path.join(REPO, 'data'), path.join(root, 'data'), { recursive: true });
  process.env.OUTBOUND_ROOT = path.join(root, 'outbound');
  return root;
}

function sent(root) {
  const dir = path.join(root, 'outbound', 'tracker');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort().map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).body);
}

test('fingerprint ignores digits', () => {
  const a = fingerprintOf('j', { type: 'E', message: 'off by 12 on 2026-11-03' });
  const b = fingerprintOf('j', { type: 'E', message: 'off by 7 on 2026-12-14' });
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{16}$/);
});

test('failed run opens one incident, repeats are suppressed inside the window', async () => {
  const root = scratch();
  await runJob('ledger-reconcile', { date: '2026-11-03', now: new Date('2026-11-04T02:00:00Z'), root });
  await runJob('ledger-reconcile', { date: '2026-11-03', now: new Date('2026-11-04T02:30:00Z'), root });
  await runJob('ledger-reconcile', { date: '2026-11-03', now: new Date('2026-11-04T04:00:00Z'), root });
  const docs = sent(root);
  assert.equal(docs.length, 2);
  assert.equal(docs[0].title, 'ledger-reconcile failed: ReconcileMismatchError');
  assert.equal(docs[0].occurrences, 1);
  assert.equal(docs[1].occurrences, 3);
  assert.ok(docs[0].log_tail.every((line) => line.startsWith('[attempt 3] ')));
  assert.deepEqual(readOplog(root).map((e) => e.incident), ['sent', 'suppressed', 'sent']);
});

test('settings are limited to the classes the tracker accepts', async () => {
  const root = scratch();
  await runJob('ledger-reconcile', { date: '2026-11-03', now: new Date('2026-11-04T02:00:00Z'), root });
  const [doc] = sent(root);
  assert.deepEqual(doc.settings, {
    'ledger.timeout_ms': 8000,
    'reconcile.batch_size': 4,
    'reconcile.tolerance_minor': 5,
  });
  assert.deepEqual(doc.settings_withheld, ['ledger.replica_dsn', 'risk.payout_holds']);
});

test('log lines that quote a withheld setting are scrubbed', async () => {
  const root = scratch();
  await runJob('statement-export', { date: '2026-11-09', now: new Date('2026-11-10T02:00:00Z'), root });
  const [doc] = sent(root);
  assert.equal(doc.error.type, 'LedgerUnavailableError');
  assert.ok(doc.log_tail.some((line) => line.includes('no snapshot for 2026-11-09 [')));
  assert.ok(!JSON.stringify(doc).includes('Quay'));
  
});

test('Risk hold notes in the log tail are scrubbed', async () => {
  const root = scratch();
  await runJob('ledger-reconcile', { date: '2026-11-03', now: new Date('2026-11-04T02:00:00Z'), root });
  const [doc] = sent(root);
  assert.ok(doc.log_tail.some((line) => line.includes('m_1068 skipped, payout held: [withheld]')));
  assert.ok(!JSON.stringify(doc).includes('RSK-2291'));
});

test('tracker outage does not change the run and is retried next time', async () => {
  const root = scratch();
  process.env.OUTBOUND_FAIL = 'tracker';
  const outcome = await runJob('ledger-reconcile', { date: '2026-11-03', now: new Date('2026-11-04T02:00:00Z'), root });
  delete process.env.OUTBOUND_FAIL;
  assert.equal(outcome.ok, false);
  assert.equal(readOplog(root)[0].incident, 'undelivered');
  await runJob('ledger-reconcile', { date: '2026-11-03', now: new Date('2026-11-04T02:05:00Z'), root });
  assert.equal(sent(root)[0].occurrences, 2);
});

test('successful run opens nothing', async () => {
  const root = scratch();
  await runJob('ledger-reconcile', { date: '2026-11-02', root });
  assert.equal(sent(root).length, 0);
});
