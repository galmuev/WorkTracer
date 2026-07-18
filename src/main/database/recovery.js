const fs = require('node:fs');
const path = require('node:path');
const { initializeConnection, validateDatabaseFile, inspectDatabaseVersion, openConnection } = require('./connection');
const { BackupManager, listBackups } = require('./backup');
const { LATEST_SCHEMA_VERSION } = require('./schema');
const { PersistenceError } = require('./errors');

async function pathExists(filePath) {
  try { await fs.promises.access(filePath); return true; } catch { return false; }
}

async function preserveForensics(databasePath, diagnosticsDirectory, error, nowMs = Date.now()) {
  await fs.promises.mkdir(diagnosticsDirectory, { recursive: true });
  const stamp = new Date(nowMs).toISOString().replace(/[:.]/g, '-');
  const preserved = [];
  for (const suffix of ['', '-wal', '-shm']) {
    const source = `${databasePath}${suffix}`;
    if (!await pathExists(source)) continue;
    const destination = path.join(diagnosticsDirectory, `${path.basename(databasePath)}.${stamp}.forensic${suffix}`);
    await fs.promises.rename(source, destination);
    preserved.push(destination);
  }
  const reportPath = path.join(diagnosticsDirectory, `recovery-${stamp}.json`);
  const report = {
    timestamp: new Date(nowMs).toISOString(),
    category: error?.category || 'unknown',
    code: error?.code || null,
    preservedFiles: preserved.map((item) => path.basename(item)),
  };
  await fs.promises.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
  return { preserved, reportPath };
}

async function restoreBackup(backupPath, databasePath, expectedVersion = LATEST_SCHEMA_VERSION) {
  const temporaryPath = `${databasePath}.restore-${process.pid}-${Date.now()}`;
  await fs.promises.copyFile(backupPath, temporaryPath);
  try {
    validateDatabaseFile(temporaryPath, { expectedVersion });
    await fs.promises.rename(temporaryPath, databasePath);
  } catch (error) {
    try { await fs.promises.unlink(temporaryPath); } catch { /* Preserve validation error. */ }
    throw error;
  }
}

async function removeFailedRecoveryCandidate(databasePath) {
  for (const suffix of ['', '-wal', '-shm']) {
    try { await fs.promises.unlink(`${databasePath}${suffix}`); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
}

async function openWithRecovery({ databasePath, backupsDirectory, diagnosticsDirectory, logger = null }) {
  await fs.promises.mkdir(path.dirname(databasePath), { recursive: true });
  const existed = await pathExists(databasePath);
  try {
    if (existed) {
      const version = inspectDatabaseVersion(databasePath);
      if (version > 0 && version < LATEST_SCHEMA_VERSION) {
        const preMigrationDb = openConnection(databasePath, { fileMustExist: true });
        try {
          const manager = new BackupManager({ db: preMigrationDb, backupsDirectory, logger });
          await manager.create('before-migration');
        } finally {
          preMigrationDb.close();
        }
      }
    }
    const connection = initializeConnection(databasePath, logger);
    return { ...connection, recovery: existed ? { status: 'not-required' } : { status: 'created' } };
  } catch (error) {
    if (error?.category === 'incompatible-schema') throw error;
    if (!existed) throw error;
    logger?.error('recovery.required', { category: error?.category, code: error?.code, state: 'recovery-required' });
    const forensic = await preserveForensics(databasePath, diagnosticsDirectory, error);
    const backups = await listBackups(backupsDirectory);
    for (const backup of backups) {
      try {
        const backupVersion = inspectDatabaseVersion(backup.path);
        if (backupVersion < 1 || backupVersion > LATEST_SCHEMA_VERSION) {
          throw new PersistenceError('incompatible-schema', `Unsupported backup schema ${backupVersion}.`);
        }
        validateDatabaseFile(backup.path, { expectedVersion: backupVersion });
        await restoreBackup(backup.path, databasePath, backupVersion);
        const connection = initializeConnection(databasePath, logger);
        logger?.info('recovery.complete', { state: 'clean', reason: 'validated-backup' });
        return { ...connection, recovery: { status: 'restored', backupCreatedAtMs: backup.mtimeMs, forensic } };
      } catch (backupError) {
        await removeFailedRecoveryCandidate(databasePath);
        logger?.warn('recovery.backup-rejected', { category: backupError?.category, code: backupError?.code, reason: 'validation-failed' });
      }
    }
    throw new PersistenceError('recovery-required', 'The database is damaged and no valid backup is available.', {
      cause: error,
      publicMessage: 'База данных повреждена. Исходные файлы сохранены для диагностики; подходящая резервная копия не найдена.',
    });
  }
}

module.exports = { openWithRecovery, preserveForensics, restoreBackup, removeFailedRecoveryCandidate, pathExists };
