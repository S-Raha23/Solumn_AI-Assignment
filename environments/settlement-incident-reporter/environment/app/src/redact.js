'use strict';

const SECRET_KEY = /pass(word|wd)?|secret|token|api[-_]?key|authorization/i;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g;
const MASK = '[redacted]';

/**
 * Deep copy of `value` for the oplog: values under secret-looking keys are
 * masked and bearer/basic credentials inside strings are scrubbed.
 */
function redact(value, key = '') {
  if (key && SECRET_KEY.test(key)) return MASK;
  if (typeof value === 'string') return value.replace(BEARER, `$1 ${MASK}`);
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redact(v, k);
    return out;
  }
  return value;
}

module.exports = { redact, MASK };
