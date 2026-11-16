'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { deliver } = require('./transport');

const DESTINATION = 'tracker';

function fingerprintOf(job, error) {
  const message = String(error.message).replace(/[0-9]+/g, '#');
  return crypto.createHash('sha256').update(`${job}|${error.type}|${message}`).digest('hex').slice(0, 16);
}

function statePath(root) {
  return path.join(root, 'var', 'incidents.json');
}

function readState(root) {
  try {
    return JSON.parse(fs.readFileSync(statePath(root), 'utf8'));
  } catch {
    return {};
  }
}

function writeState(root, state) {
  const file = statePath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n');
}

/**
 * Splits the settings a job ran with by what a destination is cleared for.
 * Every key has a class in config/schema.json and every destination lists the
 * classes it accepts. A key outside that list is left out and named in
 * `withheld`, so on-call knows it exists without seeing its value.
 */
function settingsFor(config, keys, destinationName) {
  const accepts = new Set(config.destination(destinationName).accepts);
  const settings = {};
  const withheld = [];
  for (const key of keys) {
    if (accepts.has(config.describe(key).class)) settings[key] = config.get(key);
    else withheld.push(key);
  }
  return { settings, withheld };
}

/**
 * Returns a function that removes the values of withheld settings from free
 * text. Log lines and error messages are written for the local box and can
 * quote a setting verbatim (the ledger logs its DSN, reconcile logs Risk hold
 * notes), so they get the same treatment as `settings`. Object and array
 * settings are scrubbed leaf by leaf.
 * For URL-shaped values the embedded user:password is masked as well, in case
 * the text carries the URL in a different serialisation.
 */
function scrubberFor(config, withheld) {
  const secrets = new Set();
  const leaves = (value) => {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap(leaves);
    if (value && typeof value === 'object') return Object.values(value).flatMap(leaves);
    return [];
  };
  for (const value of withheld.flatMap((key) => leaves(config.get(key)))) {
    if (value.length < 4) continue;
    secrets.add(value);
    try {
      const url = new URL(value);
      secrets.add(url.href);
      if (url.password) secrets.add(decodeURIComponent(url.password));
      if (url.password) secrets.add(url.password);
    } catch {
      // not a URL
    }
  }
  const ordered = [...secrets].sort((a, b) => b.length - a.length);
  return (text) => ordered.reduce((out, secret) => out.split(secret).join('[withheld]'), String(text));
}

/**
 * Opens (or counts) an incident for a failed run.
 * Returns 'sent', 'suppressed' or 'undelivered'. Never throws.
 */
function reportFailure(config, failure, now) {
  try {
    const nowIso = now.toISOString();
    const fingerprint = fingerprintOf(failure.job, failure.error);
    const state = readState(config.root);
    const entry = state[fingerprint] || { first_seen: nowIso, last_sent: null, occurrences: 0 };
    entry.occurrences += 1;
    state[fingerprint] = entry;

    const windowMs = config.get('incident.dedupe_window_minutes') * 60_000;
    const recentlySent = entry.last_sent && now.getTime() - Date.parse(entry.last_sent) < windowMs;
    let status = 'suppressed';
    if (!recentlySent) {
      const { settings, withheld } = settingsFor(config, failure.settingKeys, DESTINATION);
      const scrub = scrubberFor(config, withheld);
      const finalLog = failure.log[failure.log.length - 1] || [];
      const document = {
        title: `${failure.job} failed: ${failure.error.type}`,
        service: config.get('service.name'),
        job: failure.job,
        run_date: failure.date,
        occurred_at: nowIso,
        fingerprint,
        occurrences: entry.occurrences,
        attempts: failure.attempts,
        error: { type: failure.error.type, message: scrub(failure.error.message) },
        log_tail: finalLog.slice(-config.get('incident.log_tail_lines')).map(scrub),
        settings,
        settings_withheld: withheld,
      };
      try {
        deliver(config, DESTINATION, document, { sentAt: nowIso });
        entry.last_sent = nowIso;
        status = 'sent';
      } catch {
        status = 'undelivered';
      }
    }
    writeState(config.root, state);
    return status;
  } catch {
    return 'undelivered';
  }
}

module.exports = { reportFailure, fingerprintOf, settingsFor, scrubberFor };
