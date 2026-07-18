const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { initializeConnection } = require('../src/main/database/connection');
const { WorkTrackerStore } = require('../src/main/database/store');

function temporaryDirectory(prefix = 'worktracker-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createTestStore(options = {}) {
  const directory = temporaryDirectory();
  const databasePath = path.join(directory, 'worktracker.db');
  const { db } = initializeConnection(databasePath);
  const store = new WorkTrackerStore({ db, now: options.now || (() => Date.now()) });
  store.initializeDefaults();
  return {
    directory,
    databasePath,
    db,
    store,
    cleanup() {
      try { store.close(); } catch { /* Test may close it explicitly. */ }
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

module.exports = { temporaryDirectory, createTestStore };
