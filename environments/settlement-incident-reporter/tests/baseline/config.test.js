'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig, ConfigError } = require('../src/config');
const { redact, MASK } = require('../src/redact');
const { deliver, DeliveryError } = require('../src/transport');

const REPO = path.resolve(__dirname, '..');

function scratchConfig(mutate) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'settlement-cfg-'));
  fs.cpSync(path.join(REPO, 'config'), path.join(root, 'config'), { recursive: true });
  if (mutate) mutate(path.join(root, 'config'));
  return root;
}

test('loads settings and describes keys', () => {
  const config = loadConfig(scratchConfig());
  assert.equal(config.get('retry.max_attempts'), 3);
  assert.equal(config.describe('reconcile.batch_size').class, 'internal');
  assert.deepEqual(config.pick(['service.name', 'statement.currency']), {
    'service.name': 'settlement-batch',
    'statement.currency': 'EUR',
  });
  assert.deepEqual(config.destination('tracker').accepts, ['public', 'internal']);
});

test('rejects a setting that is missing from the schema', () => {
  const root = scratchConfig((dir) => {
    const file = path.join(dir, 'settings.json');
    const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    settings['reconcile.shadow_mode'] = true;
    fs.writeFileSync(file, JSON.stringify(settings));
  });
  assert.throws(() => loadConfig(root), ConfigError);
});

test('redact masks secret-looking keys and bearer credentials', () => {
  const out = redact({ user: 'ops', password: 'x', note: 'sent Bearer abcdef123456', nested: [{ api_key: 'k' }] });
  assert.deepEqual(out, { user: 'ops', password: MASK, note: `sent Bearer ${MASK}`, nested: [{ api_key: MASK }] });
});

test('deliver records the document and honours OUTBOUND_FAIL', () => {
  const config = loadConfig(scratchConfig());
  const spool = fs.mkdtempSync(path.join(os.tmpdir(), 'outbound-'));
  process.env.OUTBOUND_ROOT = spool;
  try {
    const { file } = deliver(config, 'warehouse', { hello: 'world' }, { sentAt: '2026-11-02T01:00:00.000Z' });
    const recorded = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(recorded.url, 'https://ingest.dwh.int.corvidpay.example/settlement');
    assert.deepEqual(recorded.body, { hello: 'world' });
    process.env.OUTBOUND_FAIL = 'warehouse';
    assert.throws(() => deliver(config, 'warehouse', {}, { sentAt: 'x' }), DeliveryError);
  } finally {
    delete process.env.OUTBOUND_ROOT;
    delete process.env.OUTBOUND_FAIL;
  }
});
