#!/usr/bin/env node
'use strict';
const { runJob, UnknownJobError } = require('../src/runner');
const { jobs } = require('../src/jobs');

const USAGE = `usage: run-job <job> --date YYYY-MM-DD [--now ISO-8601]\njobs: ${Object.keys(jobs).join(', ')}`;

function parseArgs(argv) {
  const args = { job: null, date: null, now: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--date') args.date = argv[(i += 1)];
    else if (argv[i] === '--now') args.now = argv[(i += 1)];
    else if (!args.job) args.job = argv[i];
    else return null;
  }
  if (!args.job || !/^\d{4}-\d{2}-\d{2}$/.test(args.date || '')) return null;
  if (args.now && Number.isNaN(Date.parse(args.now))) return null;
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error(USAGE);
    return 64;
  }
  try {
    const outcome = await runJob(args.job, {
      date: args.date,
      now: args.now ? new Date(args.now) : new Date(),
    });
    if (outcome.ok) {
      console.log(`${outcome.job} ${outcome.date}: ok after ${outcome.attempts} attempt(s)`);
      return 0;
    }
    console.error(
      `${outcome.job} ${outcome.date}: failed after ${outcome.attempts} attempt(s): ` +
        `${outcome.error.type}: ${outcome.error.message}`,
    );
    return 2;
  } catch (err) {
    if (err instanceof UnknownJobError) {
      console.error(`${err.message}\n${USAGE}`);
      return 64;
    }
    throw err;
  }
}

main().then((code) => {
  process.exitCode = code;
});
