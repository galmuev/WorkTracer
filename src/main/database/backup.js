const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { DATABASE } = require('../config');
const { LATEST_SCHEMA_VERSION } = require('./schema');
const { PersistenceError, classifySqliteError } = require('./errors');

function validateDatabaseFileOffThread(databasePath, expectedVersion, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'backup-validator-worker.js'), {
      workerData: { databasePath, expectedVersion },
    });
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      finish(() => {
        void worker.terminate();
        reject(new Error(`Backup validation timed out after ${timeoutMs} ms`));
      });
    }, timeoutMs);
    timer.unref?.();
    worker.once('message', (result) => {
      finish(() => {
        void worker.terminate();
        if (result?.ok) {
          resolve();
          return;
        }
        const error = new Error(result?.message || 'Backup validation failed');
        if (result?.code) Reflect.set(error, 'code', result.code);
        reject(error);
      });
    });
    worker.once('error', (error) => finish(() => reject(error)));
    worker.once('exit', (code) => {
      if (code !== 0) finish(() => reject(new Error(`Backup validation worker exited with code ${code}`)));
    });
  });
}

function backupName(nowMs = Date.now(), schemaVersion = LATEST_SCHEMA_VERSION) {
  const stamp = new Date(nowMs).toISOString().replace(/[:.]/g, '-');
  return `worktracker-v${schemaVersion}-${stamp}.db`;
}

async function listBackups(backupsDirectory) {
  try {
    const entries = await fs.promises.readdir(backupsDirectory, { withFileTypes: true });
    const rows = await Promise.all(entries
      .filter((entry) => entry.isFile() && /^worktracker-v\d+-.+\.db$/.test(entry.name))
      .map(async (entry) => {
        const filePath = path.join(backupsDirectory, entry.name);
        const stats = await fs.promises.stat(filePath);
        return { path: filePath, name: entry.name, mtimeMs: stats.mtimeMs };
      }));
    return rows.sort((left, right) => right.mtimeMs - left.mtimeMs);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

async function enforceRetention(backupsDirectory, nowMs = Date.now()) {
  const backups = await listBackups(backupsDirectory);
  const keep = new Set(backups.slice(0, DATABASE.backupNewestRetention).map((item) => item.path));
  const today = new Date(nowMs);
  for (let age = 0; age < DATABASE.backupDailyRetentionDays; age += 1) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - age);
    const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    const daily = backups.find((item) => item.mtimeMs >= day.getTime() && item.mtimeMs < next.getTime());
    if (daily) keep.add(daily.path);
  }
  const removed = [];
  for (const item of backups) {
    if (keep.has(item.path)) continue;
    await fs.promises.unlink(item.path);
    removed.push(item.path);
  }
  return { kept: keep.size, removed: removed.length };
}

class BackupManager {
  constructor({ db, backupsDirectory, logger = null, now = () => Date.now() }) {
    this.db = db;
    this.backupsDirectory = backupsDirectory;
    this.logger = logger;
    this.now = now;
    this.schemaVersion = Number(db.pragma('user_version', { simple: true }));
    this.lastSuccessfulBackupMs = null;
    this.backupPending = false;
    this.inProgress = null;
  }

  markCommitted() {
    this.backupPending = true;
  }

  async create(reason = 'manual') {
    if (this.inProgress) return this.inProgress;
    this.inProgress = this.#create(reason).finally(() => { this.inProgress = null; });
    return this.inProgress;
  }

  async #create(reason) {
    const nowMs = this.now();
    await fs.promises.mkdir(this.backupsDirectory, { recursive: true });
    const destination = path.join(this.backupsDirectory, backupName(nowMs, this.schemaVersion));
    this.logger?.info('backup.start', { operation: reason, schemaVersion: this.schemaVersion });
    try {
      await this.db.backup(destination);
      await validateDatabaseFileOffThread(destination, this.schemaVersion);
      this.lastSuccessfulBackupMs = nowMs;
      this.backupPending = false;
      const retention = await enforceRetention(this.backupsDirectory, nowMs);
      this.logger?.info('backup.complete', { operation: reason, schemaVersion: this.schemaVersion });
      return { path: destination, createdAtMs: nowMs, retention };
    } catch (error) {
      try { await fs.promises.unlink(destination); } catch { /* A failed backup may not have created a file. */ }
      this.logger?.error('backup.failed', { operation: reason, category: error?.category, code: error?.code });
      throw error instanceof PersistenceError ? error : classifySqliteError(error, 'Could not create a validated database backup.');
    }
  }

  async createIfDue() {
    if (!this.backupPending) return null;
    if (this.lastSuccessfulBackupMs !== null && this.now() - this.lastSuccessfulBackupMs < DATABASE.backupIntervalMs) return null;
    return this.create('periodic');
  }

  health() {
    return {
      lastSuccessfulBackupMs: this.lastSuccessfulBackupMs,
      pending: this.backupPending,
      inProgress: Boolean(this.inProgress),
    };
  }
}

module.exports = { BackupManager, backupName, listBackups, enforceRetention, validateDatabaseFileOffThread };
