'use strict';
const fs = require('node:fs');
const path = require('node:path');

class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new ConfigError(`cannot read ${path.basename(file)}: ${err.message}`);
  }
}

function appRoot() {
  return process.env.APP_ROOT || path.resolve(__dirname, '..');
}

/**
 * Loads settings, the key schema and the destination table from <root>/config
 * and checks them against each other. Everything else in the service reads
 * configuration through the object returned here.
 */
function loadConfig(root = appRoot()) {
  const dir = path.join(root, 'config');
  const settings = readJson(path.join(dir, 'settings.json'));
  const schema = readJson(path.join(dir, 'schema.json'));
  const destinations = readJson(path.join(dir, 'destinations.json'));
  const classes = new Set(schema.classes);

  for (const [key, spec] of Object.entries(schema.keys)) {
    if (!classes.has(spec.class)) {
      throw new ConfigError(`schema: ${key} has unknown class "${spec.class}"`);
    }
    if (!(key in settings)) {
      throw new ConfigError(`settings: missing ${key}`);
    }
    if (typeof settings[key] !== spec.type) {
      throw new ConfigError(`settings: ${key} must be a ${spec.type}`);
    }
  }
  for (const key of Object.keys(settings)) {
    if (!schema.keys[key]) throw new ConfigError(`settings: ${key} is not in the schema`);
  }
  for (const [name, dest] of Object.entries(destinations)) {
    if (!dest.spool || !dest.url) {
      throw new ConfigError(`destinations: ${name} needs url and spool`);
    }
    for (const cls of dest.accepts || []) {
      if (!classes.has(cls)) {
        throw new ConfigError(`destinations: ${name} accepts unknown class "${cls}"`);
      }
    }
  }

  return {
    root,
    get(key) {
      if (!(key in settings)) throw new ConfigError(`unknown setting ${key}`);
      return settings[key];
    },
    /** Schema entry ({type, class, description}) for a key. */
    describe(key) {
      const spec = schema.keys[key];
      if (!spec) throw new ConfigError(`unknown setting ${key}`);
      return { ...spec };
    },
    /** Subset of settings as a plain {key: value} object, in the order given. */
    pick(keys) {
      const out = {};
      for (const key of keys) out[key] = this.get(key);
      return out;
    },
    keys() {
      return Object.keys(settings);
    },
    destination(name) {
      const dest = destinations[name];
      if (!dest) throw new ConfigError(`unknown destination ${name}`);
      return { name, ...dest, accepts: [...(dest.accepts || [])] };
    },
  };
}

module.exports = { loadConfig, appRoot, ConfigError };
