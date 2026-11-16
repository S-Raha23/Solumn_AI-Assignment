'use strict';
const { loadConfig } = require('./config');
const { jobs } = require('./jobs');
const { appendOplog } = require('./oplog');
const { reportFailure } = require('./reporter');

class UnknownJobError extends Error {
  constructor(name) {
    super(`unknown job ${name}`);
    this.name = 'UnknownJobError';
  }
}

function makeLog(lines, attempt) {
  const write = (level) => (message) => lines.push(`[attempt ${attempt}] ${level} ${message}`);
  return { info: write('INFO'), warn: write('WARN'), error: write('ERROR') };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs one job with retries and records the result in the oplog.
 *
 * Resolves to
 *   { ok: true,  job, date, attempts, result, log }
 *   { ok: false, job, date, attempts, error: {type, message}, log }
 * where `log` holds one array of lines per attempt.
 */
async function runJob(name, { date, now = new Date(), root } = {}) {
  const job = jobs[name];
  if (!job) throw new UnknownJobError(name);
  const config = loadConfig(root);
  const settings = config.pick(job.settings);
  const maxAttempts = config.get('retry.max_attempts');
  const log = [];
  let failure = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const lines = [];
    log.push(lines);
    const logger = makeLog(lines, attempt);
    try {
      logger.info(`${name} starting for ${date}`);
      const result = job.run({ config, settings, date, now, root: config.root, log: logger });
      logger.info(`${name} finished`);
      appendOplog(config.root, {
        ts: now.toISOString(),
        service: config.get('service.name'),
        job: name,
        date,
        outcome: 'ok',
        attempts: attempt,
      });
      return { ok: true, job: name, date, attempts: attempt, result, log };
    } catch (err) {
      failure = { type: err.name || 'Error', message: err.message };
      logger.error(`${failure.type}: ${failure.message}`);
      if (attempt < maxAttempts) await sleep(config.get('retry.backoff_ms'));
    }
  }

  const outcome = { ok: false, job: name, date, attempts: maxAttempts, error: failure, log };
  const incident = reportFailure(config, { ...outcome, settingKeys: job.settings }, now);
  appendOplog(config.root, {
    ts: now.toISOString(),
    service: config.get('service.name'),
    job: name,
    date,
    outcome: 'failed',
    attempts: maxAttempts,
    error: failure,
    incident,
  });
  return { ...outcome, incident };
}

module.exports = { runJob, UnknownJobError };
