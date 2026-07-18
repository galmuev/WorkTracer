const path = require('node:path');

const DATABASE = Object.freeze({
  fileName: 'worktracker.db',
  backupsDirectoryName: 'backups',
  diagnosticsDirectoryName: 'diagnostics',
  busyTimeoutMs: 5000,
  backupIntervalMs: 15 * 60 * 1000,
  backupNewestRetention: 10,
  backupDailyRetentionDays: 7,
  overviewPageSize: 250,
  maximumPageSize: 500,
  maximumGroupMembersPerState: 2000,
  maximumIgnoredProjectsPerState: 1000,
  writeRetryCount: 2,
});

const TRACKING = Object.freeze({
  defaultPollIntervalSeconds: 1,
  maximumGapMultiplier: 3,
  maximumGapExtraMs: 1000,
  fileProbeConcurrency: 4,
  fileProbeTimeoutMs: 2000,
  monitorRestartWindowMs: 5 * 60 * 1000,
  monitorMaximumRestarts: 8,
  monitorMaximumBackoffMs: 30000,
});

function databasePaths(userDataPath) {
  const databasePath = path.join(userDataPath, DATABASE.fileName);
  return {
    databasePath,
    backupsDirectory: path.join(userDataPath, DATABASE.backupsDirectoryName),
    diagnosticsDirectory: path.join(userDataPath, DATABASE.diagnosticsDirectoryName),
  };
}

module.exports = { DATABASE, TRACKING, databasePaths };
