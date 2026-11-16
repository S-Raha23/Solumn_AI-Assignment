'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { openLedger, totalsByMerchant } = require('./ledger');

class ReconcileMismatchError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReconcileMismatchError';
  }
}

class FeedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FeedError';
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function ledgerFor(ctx) {
  return openLedger(ctx.settings['ledger.replica_dsn'], {
    root: ctx.root,
    timeoutMs: ctx.settings['ledger.timeout_ms'],
    log: ctx.log,
  });
}

/** Parses the processor's settled file: merchant,count,total_minor. */
function readProcessorFile(file) {
  if (!fs.existsSync(file)) throw new FeedError(`processor file ${path.basename(file)} not found`);
  const [header, ...lines] = fs.readFileSync(file, 'utf8').trim().split('\n');
  if (header.trim() !== 'merchant,count,total_minor') {
    throw new FeedError(`processor file ${path.basename(file)} has an unexpected header`);
  }
  const rows = new Map();
  for (const line of lines) {
    const [merchant, count, total] = line.trim().split(',');
    rows.set(merchant, { count: Number(count), total_minor: Number(total) });
  }
  return rows;
}

const jobs = {
  'ledger-reconcile': {
    settings: [
      'ledger.replica_dsn',
      'ledger.timeout_ms',
      'reconcile.batch_size',
      'reconcile.tolerance_minor',
      'risk.payout_holds',
    ],
    run(ctx) {
      const ledger = totalsByMerchant(ledgerFor(ctx).entries(ctx.date));
      const processor = readProcessorFile(
        path.join(ctx.root, 'data', 'inbox', 'processor', `settled-${ctx.date}.csv`),
      );
      const merchants = [...new Set([...ledger.keys(), ...processor.keys()])].sort();
      const size = ctx.settings['reconcile.batch_size'];
      const tolerance = ctx.settings['reconcile.tolerance_minor'];
      const holds = ctx.settings['risk.payout_holds'];
      const batches = Math.ceil(merchants.length / size);
      const drift = [];
      for (let b = 0; b < batches; b += 1) {
        for (const merchant of merchants.slice(b * size, (b + 1) * size)) {
          if (holds[merchant]) {
            ctx.log.info(`batch ${b + 1}/${batches} ${merchant} skipped, payout held: ${holds[merchant]}`);
            continue;
          }
          const ours = ledger.get(merchant) || { count: 0, total_minor: 0 };
          const theirs = processor.get(merchant) || { count: 0, total_minor: 0 };
          const delta = ours.total_minor - theirs.total_minor;
          ctx.log.info(`batch ${b + 1}/${batches} ${merchant} ledger=${ours.total_minor} processor=${theirs.total_minor}`);
          if (Math.abs(delta) > tolerance) drift.push({ merchant, delta });
        }
      }
      if (drift.length > 0) {
        const worst = drift.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
        ctx.log.error(`${drift.length} merchant(s) outside tolerance`);
        throw new ReconcileMismatchError(
          `${drift.length} merchant(s) outside tolerance on ${ctx.date}, worst ${worst.merchant} off by ${worst.delta}`,
        );
      }
      writeJson(path.join(ctx.root, 'var', 'reconcile', `${ctx.date}.json`), {
        date: ctx.date,
        merchants: merchants.length,
        total_minor: [...ledger.values()].reduce((sum, slot) => sum + slot.total_minor, 0),
      });
      return { merchants: merchants.length };
    },
  },

  'statement-export': {
    settings: ['ledger.replica_dsn', 'ledger.timeout_ms', 'statement.output_dir', 'statement.currency'],
    run(ctx) {
      const entries = ledgerFor(ctx).entries(ctx.date);
      const currency = ctx.settings['statement.currency'];
      const outDir = path.join(ctx.root, ctx.settings['statement.output_dir'], ctx.date);
      fs.mkdirSync(outDir, { recursive: true });
      const byMerchant = new Map();
      for (const entry of entries) {
        if (!byMerchant.has(entry.merchant)) byMerchant.set(entry.merchant, []);
        byMerchant.get(entry.merchant).push(entry);
      }
      for (const [merchant, rows] of byMerchant) {
        const lines = ['entry_id,kind,amount,currency'];
        for (const row of rows) {
          const signed = row.kind === 'refund' ? -row.amount_minor : row.amount_minor;
          lines.push(`${row.id},${row.kind},${(signed / 100).toFixed(2)},${currency}`);
        }
        fs.writeFileSync(path.join(outDir, `${merchant}.csv`), lines.join('\n') + '\n');
        ctx.log.info(`statement ${merchant} rows=${rows.length}`);
      }
      return { statements: byMerchant.size };
    },
  },

  'fx-rates-refresh': {
    settings: ['fx.feed_dir', 'fx.max_age_hours'],
    run(ctx) {
      const file = path.join(ctx.root, ctx.settings['fx.feed_dir'], `rates-${ctx.date}.json`);
      if (!fs.existsSync(file)) throw new FeedError(`FX feed rates-${ctx.date}.json not found`);
      const feed = JSON.parse(fs.readFileSync(file, 'utf8'));
      const ageHours = (ctx.now.getTime() - new Date(feed.published_at).getTime()) / 3_600_000;
      ctx.log.info(`feed published ${feed.published_at} pairs=${Object.keys(feed.rates).length}`);
      if (ageHours > ctx.settings['fx.max_age_hours']) {
        throw new FeedError(`FX feed is ${Math.floor(ageHours)}h old, limit is ${ctx.settings['fx.max_age_hours']}h`);
      }
      writeJson(path.join(ctx.root, 'var', 'fx', 'latest.json'), { date: ctx.date, rates: feed.rates });
      return { pairs: Object.keys(feed.rates).length };
    },
  },
};

module.exports = { jobs, ReconcileMismatchError, FeedError };
