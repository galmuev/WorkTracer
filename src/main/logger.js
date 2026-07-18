const fs = require('node:fs');
const path = require('node:path');

function sanitizeDetails(details) {
  if (!details || typeof details !== 'object') return undefined;
  const allowed = ['category', 'code', 'state', 'schemaVersion', 'operation', 'attempt', 'reason'];
  return Object.fromEntries(allowed.filter((key) => details[key] !== undefined).map((key) => [key, details[key]]));
}

function createLogger(logDirectory) {
  const logPath = path.join(logDirectory, 'worktracker.log');
  let ready = fs.promises.mkdir(logDirectory, { recursive: true });

  async function write(level, event, details) {
    const entry = JSON.stringify({ timestamp: new Date().toISOString(), level, event, details: sanitizeDetails(details) });
    try {
      await ready;
      await fs.promises.appendFile(logPath, `${entry}\n`, 'utf8');
    } catch {
      // Logging must never mask the primary failure. Console output is the last resort.
      console.error(entry);
    }
  }

  return {
    info: (event, details) => void write('info', event, details),
    warn: (event, details) => void write('warn', event, details),
    error: (event, details) => void write('error', event, details),
    path: logPath,
  };
}

module.exports = { createLogger };
