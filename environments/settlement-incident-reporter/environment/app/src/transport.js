'use strict';
const fs = require('node:fs');
const path = require('node:path');

class DeliveryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DeliveryError';
  }
}

function outboundRoot() {
  return process.env.OUTBOUND_ROOT || '/var/tmp/outbound';
}

function failing() {
  return (process.env.OUTBOUND_FAIL || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

/**
 * Posts a JSON document to a configured destination.
 * `config` is the object from loadConfig(); `sentAt` is an ISO timestamp.
 * Returns {destination, file}. Throws DeliveryError when the destination is down.
 */
function deliver(config, destinationName, document, { sentAt }) {
  const dest = config.destination(destinationName);
  if (failing().includes(dest.name)) {
    throw new DeliveryError(`${dest.name}: connection refused (${new URL(dest.url).host})`);
  }
  const body = JSON.stringify(document);
  const folder = path.join(outboundRoot(), dest.spool);
  fs.mkdirSync(folder, { recursive: true });
  const seq = String(fs.readdirSync(folder).length + 1).padStart(5, '0');
  const file = path.join(folder, `${seq}.json`);
  const request = {
    destination: dest.name,
    method: 'POST',
    url: dest.url,
    sent_at: sentAt,
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    body: JSON.parse(body),
  };
  fs.writeFileSync(file, JSON.stringify(request, null, 2) + '\n');
  return { destination: dest.name, file };
}

module.exports = { deliver, outboundRoot, DeliveryError };
