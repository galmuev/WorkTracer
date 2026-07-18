const { app, BrowserWindow, dialog, ipcMain, Menu, Tray, nativeImage, shell, powerMonitor } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { databasePaths, DATABASE } = require('./src/main/config');
const { createLogger } = require('./src/main/logger');
const { openWithRecovery } = require('./src/main/database/recovery');
const { BackupManager } = require('./src/main/database/backup');
const { WorkTrackerStore, normalizeProcessName } = require('./src/main/database/store');
const { checkInvariants } = require('./src/main/database/invariants');
const { SystemClock } = require('./src/main/services/clock');
const { AsyncFileProbe, TrackedFileResolver } = require('./src/main/services/tracked-files');
const { TrackingEngine } = require('./src/main/services/tracking-engine');
const { WindowMonitor } = require('./src/main/services/window-monitor');
const { DestructiveService } = require('./src/main/services/destructive-service');
const { ValidationError } = require('./src/main/database/errors');

const hasSingleInstanceLock = app.requestSingleInstanceLock();
const smokeTest = process.argv.includes('--smoke-test');
const startHidden = process.argv.includes('--hidden') || smokeTest;

let mainWindow;
let tray;
let store;
let backupManager;
let trackedFileResolver;
let trackingEngine;
let destructiveService;
let windowMonitor;
let logger;
let paths;
let recoveryState = { status: 'not-required' };
let currentActivity = null;
let lastExternalWindow = null;
let monitorHealth = { state: process.platform === 'win32' ? 'stopped' : 'unsupported' };
let trackingHealth = { state: 'initializing', reason: null };
let backupTimer = null;
let runtimeBroadcastTimer = null;
let sampleQueue = Promise.resolve();
let pendingIntervalDeltas = [];
let quitting = false;
let shutdownComplete = false;
let shutdownPromise = null;

const MESSAGES = {
  ru: {
    waiting: 'Ожидание целевого окна', paused: 'Учёт приостановлен', open: 'Открыть WorkTracker', pause: 'Приостановить учёт', resume: 'Возобновить учёт', exit: 'Выход',
    noActive: 'Активное внешнее окно ещё не обнаружено. Переключитесь в нужную программу, подождите {seconds} сек. и вернитесь в WorkTracker.',
    chooseExe: 'Выберите исполняемый файл программы', windowsApps: 'Программы Windows', allFiles: 'Все файлы', chooseProjectFile: 'Выберите файл проекта',
    backupFailed: 'Не удалось создать проверенную резервную копию.', openFolderFailed: 'Не удалось открыть папку данных.', autostartFailed: 'Не удалось изменить автозапуск Windows.',
  },
  en: {
    waiting: 'Waiting for a tracked window', paused: 'Tracking paused', open: 'Open WorkTracker', pause: 'Pause tracking', resume: 'Resume tracking', exit: 'Exit',
    noActive: 'No external active window has been detected yet. Switch to the required app, wait {seconds} sec., then return to WorkTracker.',
    chooseExe: 'Select the application executable', windowsApps: 'Windows applications', allFiles: 'All files', chooseProjectFile: 'Select a project file',
    backupFailed: 'Could not create a validated backup.', openFolderFailed: 'Could not open the data folder.', autostartFailed: 'Could not update Windows startup settings.',
  },
};

function message(key, values = {}) {
  const language = store?.getSettings()?.language === 'en' ? 'en' : 'ru';
  return (MESSAGES[language][key] || MESSAGES.ru[key] || key).replace(/\{(\w+)\}/g, (_match, name) => values[name] ?? '');
}

function loginItemOptions() {
  const portableExecutable = process.env.PORTABLE_EXECUTABLE_FILE;
  if (!app.isPackaged) return { path: process.execPath, args: [app.getAppPath(), '--hidden'] };
  return { path: portableExecutable || process.execPath, args: ['--hidden'] };
}

function readLaunchAtStartup() {
  if (process.platform !== 'win32') return false;
  return app.getLoginItemSettings(loginItemOptions()).openAtLogin;
}

function setLaunchAtStartup(enabled) {
  if (process.platform !== 'win32') return false;
  const options = loginItemOptions();
  app.setLoginItemSettings({ ...options, name: 'WorkTracer', openAtLogin: Boolean(enabled), enabled: Boolean(enabled) });
  return app.getLoginItemSettings(options).openAtLogin;
}

function trustedRenderer(event) {
  const url = String(event.senderFrame?.url || '');
  const expected = pathToFileURL(path.join(__dirname, 'index.html')).pathname.toLowerCase();
  let actual;
  try { actual = new URL(url).pathname.toLowerCase(); } catch { throw new ValidationError('Недоверенный IPC-источник.'); }
  if (!url.startsWith('file:') || actual !== expected) throw new ValidationError('Недоверенный IPC-источник.');
}

function publicError(error) {
  logger?.error('ipc.failure', { category: error?.category, code: error?.code, operation: 'ipc' });
  broadcastRuntime({ immediate: true });
  return new Error(error?.publicMessage || (error instanceof ValidationError ? error.message : 'Операция не выполнена. Проверьте состояние хранилища.'));
}

function handle(channel, callback) {
  ipcMain.handle(channel, async (event, ...args) => {
    trustedRenderer(event);
    try { return await callback(...args); }
    catch (error) { throw publicError(error); }
  });
}

function runtimeState() {
  const monitorError = ['degraded', 'unresponsive', 'failed'].includes(monitorHealth.state)
    ? `${monitorHealth.state}${monitorHealth.reason ? `: ${monitorHealth.reason}` : ''}` : null;
  return {
    currentActivity,
    monitorError,
    health: {
      database: store?.getHealth() || { status: 'fatal' },
      monitor: monitorHealth,
      tracking: trackingHealth,
      recovery: recoveryState,
    },
  };
}

function publicState(offset = 0, limit = DATABASE.overviewPageSize) {
  return {
    ...store.getStatePage(offset, limit),
    ...runtimeState(),
    dataFile: paths.databasePath,
    backupFile: paths.backupsDirectory,
    recoveredFromBackup: recoveryState.status === 'restored',
    platformSupported: process.platform === 'win32',
  };
}

function broadcastRuntime({ immediate = false } = {}) {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return;
  const send = () => {
    runtimeBroadcastTimer = null;
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return;
    const payload = { ...runtimeState(), intervalDeltas: pendingIntervalDeltas };
    pendingIntervalDeltas = [];
    mainWindow.webContents.send('tracker:runtime', payload);
    updateTrayMenu();
  };
  if (immediate) {
    if (runtimeBroadcastTimer) clearTimeout(runtimeBroadcastTimer);
    send();
  } else if (!runtimeBroadcastTimer) runtimeBroadcastTimer = setTimeout(send, 250);
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  mainWindow = new BrowserWindow({
    width: 1180, height: 780, minWidth: 900, minHeight: 620,
    backgroundColor: '#060b16', icon: path.join(__dirname, 'assets', 'icon.ico'),
    show: false, title: 'WorkTracker', autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const expected = pathToFileURL(path.join(__dirname, 'index.html')).pathname.toLowerCase();
    let allowed = false;
    try { allowed = new URL(url).protocol === 'file:' && new URL(url).pathname.toLowerCase() === expected; } catch { allowed = false; }
    if (!allowed) event.preventDefault();
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logger?.error('renderer.gone', { reason: details.reason, code: details.exitCode });
    if (!quitting) setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload(); }, 500);
  });
  mainWindow.loadFile('index.html').catch((error) => logger?.error('renderer.load-failed', { reason: error.code || 'load-error' }));
  mainWindow.once('ready-to-show', () => { if (!startHidden) mainWindow.show(); });
  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
      void backupManager.createIfDue().catch((error) => logger?.error('backup.background-failed', { category: error?.category, code: error?.code }));
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  return mainWindow;
}

function showWindow() {
  if (!store) return;
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('tracker:state', publicState());
  broadcastRuntime({ immediate: true });
}

async function showMainWindowOpenDialog(options) {
  const result = await dialog.showOpenDialog(mainWindow, options);
  setImmediate(() => {
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return;
    mainWindow.focus();
    mainWindow.webContents.focus();
  });
  return result;
}

function updateTrayMenu() {
  if (!tray || !store) return;
  const enabled = store.isTrackingEnabled();
  const status = currentActivity ? `${currentActivity.appName}: ${currentActivity.projectName}` : enabled ? message('waiting') : message('paused');
  tray.setToolTip(`WorkTracker — ${status}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: status, enabled: false }, { type: 'separator' },
    { label: message('open'), click: showWindow },
    { label: enabled ? message('pause') : message('resume'), click: async () => {
      try {
        await store.setTrackingEnabled(!enabled);
        trackingEngine.reset('tray-toggle');
        broadcastRuntime({ immediate: true });
      } catch (error) { logger?.error('tray.toggle-failed', { category: error?.category, code: error?.code }); }
    } },
    { type: 'separator' }, { label: message('exit'), click: () => app.quit() },
  ]));
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray-icon.png'));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.on('double-click', showWindow);
  tray.on('click', showWindow);
  updateTrayMenu();
}

function registerIpc() {
  handle('tracker:get-state', () => publicState());
  handle('tracker:get-project-page', (offset, limit) => publicState(offset, limit));
  handle('tracker:get-health', () => runtimeState().health);
  handle('tracker:get-last-active-window', () => {
    if (!lastExternalWindow) throw new ValidationError(message('noActive', { seconds: store.getSettings().pollIntervalSeconds }));
    return { ...lastExternalWindow, suggestedName: normalizeProcessName(lastExternalWindow.processName) };
  });
  handle('tracker:choose-executable', async () => {
    const result = await showMainWindowOpenDialog({
      title: message('chooseExe'), defaultPath: process.env.ProgramFiles, properties: ['openFile'],
      filters: [{ name: message('windowsApps'), extensions: ['exe'] }, { name: message('allFiles'), extensions: ['*'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const executablePath = path.resolve(result.filePaths[0]);
    const processName = path.basename(executablePath, path.extname(executablePath));
    return { processName, suggestedName: processName, executablePath };
  });
  handle('tracker:set-enabled', async (enabled) => {
    await store.setTrackingEnabled(Boolean(enabled));
    trackingEngine.reset('user-toggle');
    updateTrayMenu();
    return publicState();
  });
  handle('tracker:add-app', async (input) => { await store.addApplication(input); return publicState(); });
  handle('tracker:update-app', async (applicationId, input) => { await store.updateApplication(applicationId, input); trackingEngine.reset('application-update'); return publicState(); });
  handle('tracker:remove-app', async (applicationId) => { await destructiveService.removeApplication(applicationId); trackingEngine.reset('application-remove'); return publicState(); });
  handle('tracker:update-settings', async (input) => {
    const previous = store.getSettings();
    const requestedLaunch = input?.launchAtStartup === true || input?.launchAtStartup === 'on' || input?.launchAtStartup === 'true';
    if (previous.launchAtStartup !== requestedLaunch) {
      try { if (setLaunchAtStartup(requestedLaunch) !== requestedLaunch) throw new Error('state-mismatch'); }
      catch { throw new ValidationError(message('autostartFailed')); }
    }
    try {
      const updated = await store.updateSettings(input);
      if (previous.pollIntervalSeconds !== updated.pollIntervalSeconds) {
        trackingEngine.reset('poll-interval-change');
        await windowMonitor?.restart('poll-interval-change');
      }
      return publicState();
    } catch (error) {
      if (previous.launchAtStartup !== requestedLaunch) {
        try { setLaunchAtStartup(previous.launchAtStartup); } catch { /* Main error remains primary. */ }
      }
      throw error;
    }
  });
  handle('tracker:create-empty-project', async (name) => { await store.createEmptyProject(name); return publicState(); });
  handle('tracker:delete-project', async (member) => { await destructiveService.deleteProject(member); trackingEngine.reset('project-remove'); return publicState(); });
  handle('tracker:set-project-ignored', async (member, ignored) => {
    await store.setProjectIgnored(member, Boolean(ignored));
    trackingEngine.reset(ignored ? 'project-ignore' : 'project-restore');
    return publicState();
  });
  handle('tracker:merge-projects', async (source, target) => { await store.mergeProjects(source, target); return publicState(); });
  handle('tracker:ungroup-project', async (groupId, member) => { await store.ungroupProject(groupId, member); return publicState(); });
  handle('tracker:rename-project-group', async (groupId, name) => { await store.renameProjectGroup(groupId, name); return publicState(); });
  handle('tracker:add-tracked-file', async (applicationId) => {
    const application = store.findApplicationById(applicationId);
    if (!application || application.projectMode !== 'tracked-file') throw new ValidationError('Для программы должен быть выбран режим отслеживаемого файла.');
    const result = await showMainWindowOpenDialog({
      title: message('chooseProjectFile'), properties: ['openFile'],
      filters: application.extensions.length ? [{ name: application.name, extensions: application.extensions }, { name: message('allFiles'), extensions: ['*'] }] : [{ name: message('allFiles'), extensions: ['*'] }],
    });
    if (result.canceled || !result.filePaths[0]) return publicState();
    const filePath = path.resolve(result.filePaths[0]);
    const observation = await trackedFileResolver.inspect(filePath);
    await store.addTrackedFile(applicationId, filePath, observation);
    return publicState();
  });
  handle('tracker:add-project-link', async (sourceApplicationId, target) => { await store.addProjectLink(sourceApplicationId, target); trackingEngine.reset('link-change'); return publicState(); });
  handle('tracker:set-project-link-enabled', async (linkId, enabled) => { await store.setProjectLinkEnabled(linkId, Boolean(enabled)); trackingEngine.reset('link-change'); return publicState(); });
  handle('tracker:remove-project-link', async (linkId) => { await store.removeProjectLink(linkId); trackingEngine.reset('link-change'); return publicState(); });
  handle('tracker:clear-statistics', async () => { await destructiveService.clearTrackingData(); trackingEngine.reset('clear-data'); return publicState(); });
  handle('tracker:create-backup', async () => { await backupManager.create('manual'); return publicState(); });
  handle('tracker:open-data-folder', async () => {
    const error = await shell.openPath(path.dirname(paths.databasePath));
    if (error) throw new ValidationError(message('openFolderFailed'));
    return true;
  });
  handle('tracker:check-invariants', () => checkInvariants(store.db, { throwOnFailure: false }));
  handle('window:minimize-to-tray', async () => {
    await backupManager.createIfDue();
    mainWindow?.hide();
    return true;
  });
}

async function initialize() {
  paths = databasePaths(app.getPath('userData'));
  logger = createLogger(paths.diagnosticsDirectory);
  const opened = await openWithRecovery({ ...paths, logger });
  recoveryState = opened.recovery;
  store = new WorkTrackerStore({ db: opened.db, logger });
  store.initializeDefaults({ launchAtStartup: readLaunchAtStartup() });
  backupManager = new BackupManager({ db: opened.db, backupsDirectory: paths.backupsDirectory, logger });
  store.setBackupManager(backupManager);
  destructiveService = new DestructiveService({ store, backupManager });
  const clock = new SystemClock();
  trackedFileResolver = new TrackedFileResolver({ store, probe: new AsyncFileProbe(), clock });
  trackingEngine = new TrackingEngine({
    store, clock, trackedFileResolver,
    onActivity: (activity) => { currentActivity = activity; trackingHealth = { state: activity ? 'tracking' : 'waiting', reason: null }; broadcastRuntime(); },
    onHealth: (health) => { trackingHealth = health; broadcastRuntime(); },
    onInterval: (delta) => {
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) pendingIntervalDeltas.push(delta);
      broadcastRuntime();
    },
  });

  if (process.platform === 'win32') {
    const scriptPath = app.isPackaged ? path.join(process.resourcesPath, 'active-window.ps1') : path.join(__dirname, 'active-window.ps1');
    try {
      await fs.promises.access(scriptPath, fs.constants.R_OK);
    } catch {
      throw new Error(`active-window.ps1 not found: ${scriptPath}`);
    }
    windowMonitor = new WindowMonitor({
      scriptPath,
      pollIntervalMs: () => store.getSettings().pollIntervalSeconds * 1000,
      logger,
      onState: (health) => {
        monitorHealth = health;
        void store.recordHealthEvent('monitor', health.state, health.reason).catch(() => {});
        if (['unresponsive', 'failed'].includes(health.state)) trackingEngine.reset(health.state);
        broadcastRuntime({ immediate: true });
      },
      onSample: (sample, metadata) => {
        sampleQueue = sampleQueue.then(async () => {
          const processName = normalizeProcessName(sample?.processName);
          const ownNames = new Set(['electron', normalizeProcessName(app.getName()), normalizeProcessName(path.basename(process.execPath))]);
          if (processName && !ownNames.has(processName)) {
            lastExternalWindow = { processName: String(sample.processName).slice(0, 260), title: String(sample.title || '').trim().slice(0, 2048), capturedAt: new Date().toISOString() };
          }
          await trackingEngine.handleSample(sample, metadata);
        }).catch((error) => {
          trackingHealth = { state: 'degraded', reason: error?.category || 'sample-error' };
          logger.error('tracking.sample-failed', { category: error?.category, code: error?.code, reason: 'sample-error' });
          broadcastRuntime({ immediate: true });
        });
        return sampleQueue;
      },
    });
  }

  registerIpc();
  createWindow();
  createTray();
  windowMonitor?.start();
  backupTimer = setInterval(() => void backupManager.createIfDue().catch((error) => {
    logger.error('backup.periodic-failed', { category: error?.category, code: error?.code });
    broadcastRuntime({ immediate: true });
  }), 60 * 1000);
  powerMonitor.on('suspend', () => trackingEngine.reset('suspend'));
  powerMonitor.on('resume', () => trackingEngine.reset('resume'));
  checkInvariants(store.db);
  if (smokeTest) setTimeout(() => app.quit(), 1500);
}

async function shutdown() {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    quitting = true;
    if (backupTimer) clearInterval(backupTimer);
    if (runtimeBroadcastTimer) clearTimeout(runtimeBroadcastTimer);
    await windowMonitor?.stop().catch((error) => logger?.error('monitor.stop-failed', { reason: error?.code || 'stop-error' }));
    await sampleQueue.catch(() => {});
    await trackingEngine?.flush({ generation: windowMonitor?.generation || 0, sequence: `shutdown-${Date.now()}` }).catch((error) => logger?.error('tracking.flush-failed', { category: error?.category, code: error?.code }));
    trackedFileResolver?.close();
    await backupManager?.createIfDue().catch((error) => logger?.error('backup.shutdown-failed', { category: error?.category, code: error?.code }));
    store?.close();
    shutdownComplete = true;
  })();
  return shutdownPromise;
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => { if (app.isReady() && !argv.includes('--hidden')) showWindow(); });
  app.whenReady().then(() => {
    app.setAppUserModelId('com.worktracer.app');
    return initialize();
  }).catch((error) => {
    const detail = error?.publicMessage || error?.message || 'Unknown initialization error.';
    logger?.error('application.initialization-failed', { category: error?.category, code: error?.code, state: 'fatal' });
    dialog.showErrorBox('WorkTracker', detail);
    app.quit();
  });
  app.on('before-quit', (event) => {
    if (shutdownComplete) return;
    event.preventDefault();
    void shutdown().finally(() => app.quit());
  });
  app.on('window-all-closed', () => { /* Keep running in the tray. */ });
  app.on('activate', showWindow);
}
