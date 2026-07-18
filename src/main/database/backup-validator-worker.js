'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { validateDatabaseFile } = require('./connection');

try {
  validateDatabaseFile(workerData.databasePath, { expectedVersion: workerData.expectedVersion });
  parentPort.postMessage({ ok: true });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    message: error instanceof Error ? error.message : String(error),
    code: error?.code ?? null,
  });
}
