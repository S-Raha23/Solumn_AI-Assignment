'use strict';
const fs = require('node:fs');
const path = require('node:path');

class LedgerUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LedgerUnavailableError';
  }
}

/**
 * libpq keyword/value connection string for a postgresql:// URL, the form the
 * driver takes and reports in its connection errors.
 */
function conninfo(url, timeoutMs) {
  const parts = {
    host: url.hostname,
    port: url.port || '5432',
    dbname: url.pathname.replace(/^\//, ''),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    connect_timeout: String(Math.ceil(timeoutMs / 1000)),
    sslmode: url.searchParams.get('sslmode') || 'prefer',
  };
  return Object.entries(parts)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
}

/**
 * Opens the read-only ledger replica named by a DSN.
 * In this image the database name maps to a snapshot folder (see docs/operations.md).
 */
function openLedger(dsn, { root, timeoutMs, log }) {
  let url;
  try {
    url = new URL(dsn);
  } catch {
    throw new LedgerUnavailableError('replica DSN is not a valid URL');
  }
  if (url.protocol !== 'postgresql:') {
    throw new LedgerUnavailableError(`unsupported replica protocol ${url.protocol}`);
  }
  const database = url.pathname.replace(/^\//, '');
  if (!database) throw new LedgerUnavailableError('replica DSN names no database');
  const folder = path.join(root, 'data', 'ledger', database);
  log.info(`replica ${url.hostname}:${url.port || 5432}/${database} timeout=${timeoutMs}ms`);

  return {
    database,
    /** All ledger entries booked on a settlement date. */
    entries(date) {
      const file = path.join(folder, `entries-${date}.jsonl`);
      if (!fs.existsSync(file)) {
        log.error(`no snapshot for ${date} [${conninfo(url, timeoutMs)}]`);
        throw new LedgerUnavailableError(`replica has no snapshot for ${date}`);
      }
      const rows = [];
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        const row = JSON.parse(line);
        if (!row.merchant || !Number.isInteger(row.amount_minor)) {
          throw new LedgerUnavailableError(`malformed ledger entry in ${path.basename(file)}`);
        }
        rows.push(row);
      }
      log.info(`replica returned ${rows.length} entries for ${date}`);
      return rows;
    },
  };
}

/** Sums entries per merchant: Map<merchant, {count, total_minor}>, sorted by merchant. */
function totalsByMerchant(entries) {
  const totals = new Map();
  for (const entry of entries) {
    const slot = totals.get(entry.merchant) || { count: 0, total_minor: 0 };
    slot.count += 1;
    slot.total_minor += entry.kind === 'refund' ? -entry.amount_minor : entry.amount_minor;
    totals.set(entry.merchant, slot);
  }
  return new Map([...totals.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

module.exports = { openLedger, totalsByMerchant, LedgerUnavailableError };
