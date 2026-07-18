const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { temporaryDirectory } = require('./helpers');
const { initializeConnection } = require('../src/main/database/connection');
const { WorkTrackerStore } = require('../src/main/database/store');
const { BackupManager, listBackups, enforceRetention } = require('../src/main/database/backup');
const { openWithRecovery } = require('../src/main/database/recovery');

async function populatedDatabase(directory) {
  const databasePath = path.join(directory, 'worktracker.db');
  const opened = initializeConnection(databasePath);
  const store = new WorkTrackerStore({ db: opened.db });
  store.initializeDefaults();
  await store.setTrackingEnabled(false);
  return { databasePath, db: opened.db, store };
}

test('online backup creates a validated generation', async () => {
  const directory = temporaryDirectory();
  const backupsDirectory = path.join(directory, 'backups');
  const fixture = await populatedDatabase(directory);
  const manager = new BackupManager({ db: fixture.db, backupsDirectory });
  const result = await manager.create('test');
  assert.ok(fs.existsSync(result.path));
  assert.equal((await listBackups(backupsDirectory)).length, 1);
  fixture.store.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('retention keeps newest generations and removes excess old files', async () => {
  const directory = temporaryDirectory();
  const now = Date.now();
  for (let index = 0; index < 15; index += 1) {
    const file = path.join(directory, `worktracker-v1-2020-01-01T00-00-${String(index).padStart(2, '0')}-000Z.db`);
    fs.writeFileSync(file, 'fixture');
    const timestamp = new Date(now - index * 60 * 1000);
    fs.utimesSync(file, timestamp, timestamp);
  }
  const result = await enforceRetention(directory, now);
  assert.ok(result.kept >= 10);
  assert.ok(result.removed > 0);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('missing database is created, migrated and reported as created', async () => {
  const directory = temporaryDirectory();
  const result = await openWithRecovery({
    databasePath: path.join(directory, 'worktracker.db'),
    backupsDirectory: path.join(directory, 'backups'),
    diagnosticsDirectory: path.join(directory, 'diagnostics'),
  });
  assert.equal(result.recovery.status, 'created');
  result.db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('corrupt main database is preserved and restored from a valid backup', async () => {
  const directory = temporaryDirectory();
  const backupsDirectory = path.join(directory, 'backups');
  const diagnosticsDirectory = path.join(directory, 'diagnostics');
  const fixture = await populatedDatabase(directory);
  const manager = new BackupManager({ db: fixture.db, backupsDirectory });
  await manager.create('recovery-test');
  fixture.store.close();
  fs.writeFileSync(fixture.databasePath, 'not a sqlite database');
  const restored = await openWithRecovery({ databasePath: fixture.databasePath, backupsDirectory, diagnosticsDirectory });
  assert.equal(restored.recovery.status, 'restored');
  assert.ok(restored.recovery.forensic.preserved.length >= 1);
  restored.db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('corrupt newest backup is skipped in favor of previous valid generation', async () => {
  const directory = temporaryDirectory();
  const backupsDirectory = path.join(directory, 'backups');
  const diagnosticsDirectory = path.join(directory, 'diagnostics');
  let clock = Date.now();
  const fixture = await populatedDatabase(directory);
  const manager = new BackupManager({ db: fixture.db, backupsDirectory, now: () => clock });
  await manager.create('older');
  clock += 1000;
  const newest = await manager.create('newer');
  fixture.store.close();
  fs.writeFileSync(newest.path, 'corrupt backup');
  fs.writeFileSync(fixture.databasePath, 'corrupt main');
  const restored = await openWithRecovery({ databasePath: fixture.databasePath, backupsDirectory, diagnosticsDirectory });
  assert.equal(restored.recovery.status, 'restored');
  restored.db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('no valid backup enters recovery-required without creating empty data', async () => {
  const directory = temporaryDirectory();
  const databasePath = path.join(directory, 'worktracker.db');
  fs.writeFileSync(databasePath, 'corrupt main');
  await assert.rejects(openWithRecovery({
    databasePath,
    backupsDirectory: path.join(directory, 'backups'),
    diagnosticsDirectory: path.join(directory, 'diagnostics'),
  }), (error) => error.category === 'recovery-required');
  assert.equal(fs.existsSync(databasePath), false);
  assert.ok(fs.readdirSync(path.join(directory, 'diagnostics')).some((name) => name.includes('forensic')));
  fs.rmSync(directory, { recursive: true, force: true });
});

test('backup failure does not damage the open primary database', async () => {
  const directory = temporaryDirectory();
  const fixture = await populatedDatabase(directory);
  const invalidDirectory = path.join(directory, 'not-a-directory');
  fs.writeFileSync(invalidDirectory, 'file');
  const manager = new BackupManager({ db: fixture.db, backupsDirectory: invalidDirectory });
  await assert.rejects(manager.create('forced-failure'));
  assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM applications').get().count, 3);
  fixture.store.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('newer incompatible schema is not mistaken for corruption recovery', async () => {
  const directory = temporaryDirectory();
  const databasePath = path.join(directory, 'future.db');
  const db = require('../src/main/database/connection').openConnection(databasePath);
  db.pragma('user_version = 999');
  db.close();
  await assert.rejects(openWithRecovery({
    databasePath,
    backupsDirectory: path.join(directory, 'backups'),
    diagnosticsDirectory: path.join(directory, 'diagnostics'),
  }), (error) => error.category === 'incompatible-schema');
  assert.equal(fs.existsSync(databasePath), true);
  assert.equal(fs.existsSync(path.join(directory, 'diagnostics')), false);
  fs.rmSync(directory, { recursive: true, force: true });
});
