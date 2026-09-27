const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('arixDesktop', {
  getVersion: () => ipcRenderer.invoke('app:version'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  openLogsFolder: () => ipcRenderer.invoke('app:open-logs-folder'),
  revealInFolder: (path) => ipcRenderer.invoke('app:reveal-in-folder', path),
  platform: process.platform,
})

contextBridge.exposeInMainWorld('arixSettings', {
  get: () => ipcRenderer.invoke('settings:get'),
  set: (patch) => ipcRenderer.invoke('settings:set', patch),
  getApiKey: () => ipcRenderer.invoke('settings:getApiKey'),
  setApiKey: (key) => ipcRenderer.invoke('settings:setApiKey', key),
  testApiKey: (key) => ipcRenderer.invoke('settings:testApiKey', key),
  reset: () => ipcRenderer.invoke('settings:reset'),
})

contextBridge.exposeInMainWorld('arixProjects', {
  selectFolder: () => ipcRenderer.invoke('dialog:openDirectory'),
})

contextBridge.exposeInMainWorld('arixScreenShare', {
  getSources: (opts) => ipcRenderer.invoke('desktopCapturer:getSources', opts),
})
