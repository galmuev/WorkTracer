const Database = require('better-sqlite3');
const { DATABASE } = require('../config');
const { LATEST_SCHEMA_VERSION, runMigrations, validateSchema, quickCheck, schemaVersion } = require('./schema');
const { PersistenceError, classifySqliteError } = require('./errors');

function openConnection(databasePath, options = {}) {
  let db;
  try {
    db = new Database(databasePath, {
      readonly: Boolean(options.readonly),
      fileMustExist: Boolean(options.fileMustExist),
      timeout: DATABASE.busyTimeoutMs,
    });
    db.pragma('foreign_keys = ON');
    db.pragma(`busy_timeout = ${DATABASE.busyTimeoutMs}`);
    if (!options.readonly) {
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = FULL');
      db.pragma('wal_autocheckpoint = 1000');
      db.pragma('trusted_schema = OFF');
    }
    return db;
  } catch (error) {
    try { db?.close(); } catch { /* The original open error is more useful. */ }
    throw classifySqliteError(error, 'Could not open the WorkTracker database.');
  }
}

function initializeConnection(databasePath, logger) {
  const db = openConnection(databasePath);
  try {
    quickCheck(db);
    try { runMigrations(db, logger); }
    catch (error) {
      if (error?.category === 'incompatible-schema') throw error;
      throw new PersistenceError('migration-failure', 'Database migration failed.', { cause: error, code: error?.code });
    }
    const schema = validateSchema(db);
    logger?.info('database.open', { schemaVersion: schema.version, state: 'clean' });
    return { db, schema };
  } catch (error) {
    try { db.close(); } catch { /* Preserve the primary error. */ }
    throw error;
  }
}

function validateDatabaseFile(databasePath, { expectedVersion = LATEST_SCHEMA_VERSION } = {}) {
  const db = openConnection(databasePath, { readonly: true, fileMustExist: true });
  try {
    quickCheck(db);
    const version = schemaVersion(db);
    if (version !== expectedVersion) {
      throw new PersistenceError('incompatible-schema', `Expected backup schema ${expectedVersion}, found ${version}.`);
    }
    if (version === LATEST_SCHEMA_VERSION) return validateSchema(db);
    return { version, legacySchemaValidatedByIntegrityOnly: true };
  } finally {
    db.close();
  }
}

function inspectDatabaseVersion(databasePath) {
  const db = openConnection(databasePath, { readonly: true, fileMustExist: true });
  try {
    return schemaVersion(db);
  } finally {
    db.close();
  }
}

module.exports = { openConnection, initializeConnection, validateDatabaseFile, inspectDatabaseVersion };
