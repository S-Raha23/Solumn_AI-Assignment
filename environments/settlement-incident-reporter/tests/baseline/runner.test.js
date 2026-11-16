'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runJob } = require('../src/runner');
const { readOplog } = require('../src/oplog');

const REPO = path.resolve(__dirname, '..');

/** Copies config and data into a scratch root so tests never touch the checkout. */
function scratchRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'settlement-'));
  fs.cpSync(path.join(REPO, 'config'), path.join(root, 'config'), { recursive: true });
  fs.cpSync(path.join(REPO, 'data'), path.join(root, 'data'), { recursive: true });
  return root;
}

test('reconcile succeeds on a balanced day and writes the summary', async () => {
  const root = scratchRoot();
  const outcome = await runJob('ledger-reconcile', { date: '2026-11-02', root });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.attempts, 1);
  const summary = JSON.parse(fs.readFileSync(path.join(root, 'var/reconcile/2026-11-02.json'), 'utf8'));
  assert.equal(summary.merchants, 6);
  assert.equal(summary.total_minor, 429250);
});

test('reconcile fails after all attempts when a merchant drifts', async () => {
  const root = scratchRoot();
  const outcome = await runJob('ledger-reconcile', { date: '2026-11-03', root });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.attempts, 3);
  assert.equal(outcome.error.type, 'ReconcileMismatchError');
  assert.match(outcome.error.message, /worst m_1042 off by -1250/);
  assert.equal(outcome.log.length, 3);
  const [entry] = readOplog(root);
  assert.equal(entry.outcome, 'failed');
  assert.equal(entry.error.type, 'ReconcileMismatchError');
});

test('statement export writes one file per merchant', async () => {
  const root = scratchRoot();
  const outcome = await runJob('statement-export', { date: '2026-11-02', root });
  assert.equal(outcome.ok, true);
  const dir = path.join(root, 'var/statements/2026-11-02');
  assert.equal(fs.readdirSync(dir).length, 6);
  const lines = fs.readFileSync(path.join(dir, 'm_1007.csv'), 'utf8').trim().split('\n');
  assert.equal(lines[0], 'entry_id,kind,amount,currency');
  assert.ok(lines.includes('e-20003,refund,-45.00,EUR'));
});

test('fx refresh rejects a stale feed', async () => {
  const root = scratchRoot();
  const outcome = await runJob('fx-rates-refresh', {
    date: '2026-11-02',
    now: new Date('2026-11-04T09:00:00Z'),
    root,
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error.type, 'FeedError');
});
