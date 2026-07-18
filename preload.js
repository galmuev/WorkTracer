const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('workTracker', {
  getState: () => ipcRenderer.invoke('tracker:get-state'),
  getProjectPage: (offset, limit) => ipcRenderer.invoke('tracker:get-project-page', offset, limit),
  getHealth: () => ipcRenderer.invoke('tracker:get-health'),
  getLastActiveWindow: () => ipcRenderer.invoke('tracker:get-last-active-window'),
  chooseExecutable: () => ipcRenderer.invoke('tracker:choose-executable'),
  setEnabled: (enabled) => ipcRenderer.invoke('tracker:set-enabled', enabled),
  addApp: (app) => ipcRenderer.invoke('tracker:add-app', app),
  updateApp: (id, app) => ipcRenderer.invoke('tracker:update-app', id, app),
  removeApp: (id) => ipcRenderer.invoke('tracker:remove-app', id),
  updateSettings: (settings) => ipcRenderer.invoke('tracker:update-settings', settings),
  createBackup: () => ipcRenderer.invoke('tracker:create-backup'),
  openDataFolder: () => ipcRenderer.invoke('tracker:open-data-folder'),
  deleteProject: (project) => ipcRenderer.invoke('tracker:delete-project', project),
  mergeProjects: (source, target) => ipcRenderer.invoke('tracker:merge-projects', source, target),
  ungroupProject: (groupId, project) => ipcRenderer.invoke('tracker:ungroup-project', groupId, project),
  renameProjectGroup: (groupId, name) => ipcRenderer.invoke('tracker:rename-project-group', groupId, name),
  addTrackedFile: (appId) => ipcRenderer.invoke('tracker:add-tracked-file', appId),
  createEmptyProject: (name) => ipcRenderer.invoke('tracker:create-empty-project', name),
  addProjectLink: (sourceAppId, target) => ipcRenderer.invoke('tracker:add-project-link', sourceAppId, target),
  setProjectLinkEnabled: (linkId, enabled) => ipcRenderer.invoke('tracker:set-project-link-enabled', linkId, enabled),
  removeProjectLink: (linkId) => ipcRenderer.invoke('tracker:remove-project-link', linkId),
  clearStatistics: () => ipcRenderer.invoke('tracker:clear-statistics'),
  minimizeToTray: () => ipcRenderer.invoke('window:minimize-to-tray'),
  onState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('tracker:state', handler);
    return () => ipcRenderer.removeListener('tracker:state', handler);
  },
  onRuntime: (callback) => {
    const handler = (_event, runtime) => callback(runtime);
    ipcRenderer.on('tracker:runtime', handler);
    return () => ipcRenderer.removeListener('tracker:runtime', handler);
  },
});
