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

contextBridge.exposeInMainWorld('arixOverlay', {
  onState: (callback) => {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('overlay:state-update', listener)
    return () => ipcRenderer.removeListener('overlay:state-update', listener)
  },
  restoreMain: () => ipcRenderer.invoke('overlay:restore-main'),
  resize: (width, height) => ipcRenderer.invoke('overlay:resize', width, height),
  setIgnoreMouseEvents: (ignore, options) =>
    ipcRenderer.invoke('overlay:set-ignore-mouse-events', ignore, options),
  sendPermissionDecision: (callId, approved) =>
    ipcRenderer.invoke('overlay:permission-decision', callId, approved),
  broadcastLiveState: (payload) => ipcRenderer.invoke('main:broadcast-live-state', payload),
  onPermissionDecisionFromOverlay: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('main:permission-decision-from-overlay', listener)
    return () => ipcRenderer.removeListener('main:permission-decision-from-overlay', listener)
  },
  onEndLiveSession: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('main:end-live-session', listener)
    return () => ipcRenderer.removeListener('main:end-live-session', listener)
  },
  onToggleMicMute: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('main:toggle-mic-mute', listener)
    return () => ipcRenderer.removeListener('main:toggle-mic-mute', listener)
  },
})
