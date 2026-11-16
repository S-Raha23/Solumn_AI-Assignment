'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { deliver } = require('./transport');
const { redact } = require('./redact');

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
 * The settings a job ran with, scrubbed the same way oplog entries are.
 */
function settingsFor(config, keys) {
  return redact(config.pick(keys));
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
      const settings = settingsFor(config, failure.settingKeys);
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
        error: { type: failure.error.type, message: failure.error.message },
        log_tail: finalLog.slice(-config.get('incident.log_tail_lines')),
        settings,
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

module.exports = { reportFailure, fingerprintOf, settingsFor };
