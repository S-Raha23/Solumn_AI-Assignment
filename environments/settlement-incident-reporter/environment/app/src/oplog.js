'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { redact } = require('./redact');

function oplogPath(root) {
  return path.join(root, 'var', 'oplog.ndjson');
}

/** Appends one run record to var/oplog.ndjson. */
function appendOplog(root, entry) {
  const file = oplogPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(redact(entry)) + '\n');
}

function readOplog(root) {
  const file = oplogPath(root);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

module.exports = { appendOplog, readOplog, oplogPath };
