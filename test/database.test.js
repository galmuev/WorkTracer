const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { temporaryDirectory, createTestStore } = require('./helpers');
const { initializeConnection, openConnection } = require('../src/main/database/connection');
const { LATEST_SCHEMA_VERSION, MIGRATIONS, validateSchema } = require('../src/main/database/schema');
const { checkInvariants } = require('../src/main/database/invariants');
const { classifySqliteError } = require('../src/main/database/errors');

test('new database migrates to the latest schema and can reopen idempotently', () => {
  const directory = temporaryDirectory();
  const file = path.join(directory, 'new.db');
  const first = initializeConnection(file);
  assert.equal(first.schema.version, LATEST_SCHEMA_VERSION);
  first.db.close();
  const second = initializeConnection(file);
  assert.equal(validateSchema(second.db).version, LATEST_SCHEMA_VERSION);
  second.db.close();
  require('node:fs').rmSync(directory, { recursive: true, force: true });
});

test('unknown newer schema is rejected without modification', () => {
  const directory = temporaryDirectory();
  const file = path.join(directory, 'future.db');
  const db = openConnection(file);
  db.pragma(`user_version = ${LATEST_SCHEMA_VERSION + 10}`);
  db.close();
  assert.throws(() => initializeConnection(file), (error) => error.category === 'incompatible-schema');
  const inspect = openConnection(file, { readonly: true, fileMustExist: true });
  assert.equal(inspect.pragma('user_version', { simple: true }), LATEST_SCHEMA_VERSION + 10);
  inspect.close();
  require('node:fs').rmSync(directory, { recursive: true, force: true });
});

test('version 1 database migrates to ignored-project schema without losing projects', () => {
  const directory = temporaryDirectory();
  const file = path.join(directory, 'version-1.db');
  const legacy = openConnection(file);
  legacy.exec(MIGRATIONS[0].sql);
  legacy.pragma('user_version = 1');
  legacy.prepare(`INSERT INTO applications(id, name, process_name, normalized_process_name, project_mode,
    title_segment_from_end, is_manual, created_at_ms, updated_at_ms)
    VALUES ('legacy-app', 'Legacy', 'legacy', 'legacy', 'file', 2, 0, 1, 1)`).run();
  legacy.prepare("INSERT INTO projects(id, application_id, name, kind, created_at_ms, updated_at_ms) VALUES ('legacy-project', 'legacy-app', 'Legacy project', 'normal', 1, 1)").run();
  legacy.close();
  const migrated = initializeConnection(file);
  assert.equal(migrated.schema.version, LATEST_SCHEMA_VERSION);
  assert.equal(migrated.db.prepare("SELECT is_ignored FROM projects WHERE id = 'legacy-project'").get().is_ignored, 0);
  migrated.db.close();
  require('node:fs').rmSync(directory, { recursive: true, force: true });
});

test('failed migration rolls back schema changes and version atomically', () => {
  const directory = temporaryDirectory();
  const file = path.join(directory, 'migration-failure.db');
  const broken = openConnection(file);
  broken.exec('CREATE TABLE settings (broken TEXT)');
  broken.close();
  assert.throws(() => initializeConnection(file), (error) => error.category === 'migration-failure');
  const inspect = openConnection(file, { readonly: true, fileMustExist: true });
  assert.equal(inspect.pragma('user_version', { simple: true }), 0);
  assert.equal(inspect.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'applications'").get().count, 0);
  inspect.close();
  require('node:fs').rmSync(directory, { recursive: true, force: true });
});

test('schema validation rejects a missing consistency trigger', () => {
  const fixture = createTestStore();
  try {
    fixture.db.exec('DROP TRIGGER allocations_validate_insert');
    assert.throws(() => validateSchema(fixture.db), (error) => error.category === 'corruption');
  } finally { fixture.cleanup(); }
});

test('foreign keys and interval constraints are enforced', () => {
  const fixture = createTestStore();
  try {
    assert.equal(fixture.db.pragma('foreign_keys', { simple: true }), 1);
    assert.throws(() => fixture.db.prepare(`INSERT INTO projects(id, application_id, name, kind, created_at_ms, updated_at_ms)
      VALUES ('orphan', 'missing', 'orphan', 'normal', 1, 1)`).run(), /FOREIGN KEY/);
    assert.throws(() => fixture.db.prepare(`INSERT INTO tracking_intervals(
      id, sample_id, application_id, project_id, start_wall_ms, end_wall_ms, duration_ms, monitor_generation, created_at_ms
    ) VALUES ('bad', 'bad', 'blender', 'missing', 2, 1, -1, 0, 1)`).run(), /CHECK|FOREIGN KEY/);
  } finally { fixture.cleanup(); }
});

test('compound transaction rolls back completely', () => {
  const fixture = createTestStore();
  try {
    const before = fixture.db.prepare('SELECT COUNT(*) AS count FROM applications').get().count;
    const operation = fixture.db.transaction(() => {
      fixture.db.prepare(`INSERT INTO applications(id, name, process_name, normalized_process_name, project_mode,
        title_segment_from_end, is_manual, created_at_ms, updated_at_ms)
        VALUES ('rollback', 'Rollback', 'rollback', 'rollback', 'file', 2, 0, 1, 1)`).run();
      throw new Error('forced failure');
    });
    assert.throws(operation, /forced failure/);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM applications').get().count, before);
  } finally { fixture.cleanup(); }
});

test('read-only connection reports a classified write failure', async () => {
  const fixture = createTestStore();
  fixture.store.close();
  const readonly = openConnection(fixture.databasePath, { readonly: true, fileMustExist: true });
  const { WorkTrackerStore } = require('../src/main/database/store');
  const store = new WorkTrackerStore({ db: readonly });
  await assert.rejects(store.setTrackingEnabled(false), (error) => ['permission/read-only', 'unknown-fatal'].includes(error.category));
  readonly.close();
  require('node:fs').rmSync(fixture.directory, { recursive: true, force: true });
});

test('SQLite error classification covers busy, full and corruption', () => {
  assert.equal(classifySqliteError({ code: 'SQLITE_BUSY' }).category, 'busy/locked');
  assert.equal(classifySqliteError({ code: 'SQLITE_FULL' }).category, 'disk-full');
  assert.equal(classifySqliteError({ code: 'SQLITE_CORRUPT' }).category, 'corruption');
});

test('invariant checker validates a healthy database', () => {
  const fixture = createTestStore();
  try { assert.deepEqual(checkInvariants(fixture.db), { ok: true, failures: [] }); }
  finally { fixture.cleanup(); }
});

test('store closes its single managed connection', () => {
  const fixture = createTestStore();
  fixture.store.close();
  assert.equal(fixture.db.open, false);
  fixture.cleanup();
});

test('interface language is persisted and returned after settings update', async () => {
  const fixture = createTestStore();
  try {
    const current = fixture.store.getSettings();
    const updated = await fixture.store.updateSettings({ ...current, language: 'en' });
    assert.equal(updated.language, 'en');
    assert.equal(fixture.store.getSettings().language, 'en');
  } finally { fixture.cleanup(); }
});

test('busy writer is retried only after SQLite reports rollback-safe lock failure', async () => {
  const fixture = createTestStore();
  const secondDb = openConnection(fixture.databasePath, { fileMustExist: true });
  secondDb.pragma('busy_timeout = 1');
  const { WorkTrackerStore } = require('../src/main/database/store');
  const secondStore = new WorkTrackerStore({ db: secondDb });
  try {
    fixture.db.exec('BEGIN IMMEDIATE');
    await assert.rejects(secondStore.setTrackingEnabled(false), (error) => error.category === 'busy/locked');
  } finally {
    fixture.db.exec('ROLLBACK');
    secondDb.close();
    fixture.cleanup();
  }
});

test('critical interval query uses the application/end-time index', () => {
  const fixture = createTestStore();
  try {
    const plan = fixture.db.prepare(`EXPLAIN QUERY PLAN SELECT * FROM tracking_intervals
      WHERE application_id = ? ORDER BY end_wall_ms DESC LIMIT 100`).all('blender');
    assert.ok(plan.some((row) => String(row.detail).includes('tracking_intervals_application_end_idx')));
  } finally { fixture.cleanup(); }
});

test('overview pagination does not load ten thousand projects into the initial state', () => {
  const fixture = createTestStore();
  try {
    const insert = fixture.db.prepare("INSERT INTO projects(id, application_id, name, kind, created_at_ms, updated_at_ms) VALUES (?, 'blender', ?, 'normal', ?, ?)");
    fixture.db.transaction(() => {
      for (let index = 0; index < 10_000; index += 1) insert.run(`scale-${index}`, `scale-${index}.blend`, index + 1, index + 1);
    })();
    const state = fixture.store.getStatePage(0, 250);
    assert.equal(state.pagination.hasMore, true);
    assert.ok(state.pagination.total >= 10_000);
    assert.ok(Object.keys(state.statistics.blender.projects).length <= 250);
  } finally { fixture.cleanup(); }
});
