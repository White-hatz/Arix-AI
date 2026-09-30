const { app, BrowserWindow, ipcMain, shell, safeStorage, dialog, desktopCapturer, Tray, Menu, screen, globalShortcut, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')
const http = require('http')

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL)

if (isDev) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'
}

const defaultSettings = {
  apiKey: '',
  directAssistantModel: 'gemini-3.8-live',
  coderAgentModel: 'gemini-3.8-live-extended-thinking',
  extendedThinkingEnabled: true,
  thinkingBudget: 'high',
  voice: 'Kore',
  inputDeviceId: 'default',
  outputDeviceId: 'default',
  vadSensitivity: 'medium',
  pushToTalk: false,
  directAssistantInstructions:
    'You are Arix, an articulate, voice-first desktop engineering partner. Listen to the user, understand their goals, synthesize clear structured plans, and coordinate with the Coder Agent.',
  coderAgentInstructions:
    'You are Arix Coder, an autonomous coding agent. Execute plans thoroughly, read minimal necessary file slices, make batched edits, verify code with tests and browser automation, and report clearly.',
  longTermMemoryEnabled: true,
  memoryLocation: 'local',
  allowMouseKeyboardControl: true,
  allowAutoTerminalCommands: false,
  allowAutonomousBrowser: true,
  allowedWorkspaceDirectories: [],
  theme: 'glass-black',
  editorFontSize: 13,
  composioApiKey: '',
  githubToken: '',
  githubUsername: '',

  // Overlay / Desktop Companion Mode Settings (Section 7)
  overlayEnabled: true,
  overlayCorner: 'bottom-right',
  overlayClickThrough: true,
  overlayClickToRestore: true,
  overlaySubtitleFontSize: 19,
  overlaySubtitleHoldDuration: 3.5,
  overlayShowUserSpeech: false,
  overlayAlwaysOnTop: true,
  overlayKeepAlive: true,
}

let mainWindow = null
let overlayWindow = null
let tray = null
let isQuitting = false
let isLiveActive = false
let isOverlayActive = false
let isMicMuted = false
let currentLiveState = {
  status: 'offline',
  level: 0,
  subtitle: '',
  isThinking: false,
  isMuted: false,
  permissionPrompt: null,
  desktopControlActive: false,
}

function getConfigPath() {
  return path.join(app.getPath('userData'), 'arix-config.json')
}

function encryptSecret(plaintext) {
  if (!plaintext) return ''
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const buffer = safeStorage.encryptString(plaintext)
      return 'enc:' + buffer.toString('base64')
    }
  } catch (err) {
    console.error('[Main] safeStorage.encryptString error:', err)
  }
  return 'b64:' + Buffer.from(plaintext, 'utf-8').toString('base64')
}

function decryptSecret(encrypted) {
  if (!encrypted) return ''
  try {
    if (encrypted.startsWith('enc:') && safeStorage.isEncryptionAvailable()) {
      const buffer = Buffer.from(encrypted.slice(4), 'base64')
      return safeStorage.decryptString(buffer)
    }
    if (encrypted.startsWith('b64:')) {
      return Buffer.from(encrypted.slice(4), 'base64').toString('utf-8')
    }
    return encrypted
  } catch (err) {
    console.error('[Main] safeStorage.decryptString error:', err)
    return ''
  }
}

function loadConfig() {
  const file = getConfigPath()
  let config = { ...defaultSettings }
  if (fs.existsSync(file)) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
      const decryptedKey = decryptSecret(raw.encryptedApiKey || '')
      const decryptedComposioKey = decryptSecret(raw.encryptedComposioApiKey || '')
      const decryptedGithubToken = decryptSecret(raw.encryptedGithubToken || '')
      config = {
        ...defaultSettings,
        ...raw,
        apiKey: decryptedKey,
        composioApiKey: decryptedComposioKey,
        githubToken: decryptedGithubToken,
      }
    } catch (err) {
      console.error('[Main] Failed to load config:', err)
    }
  }

  // Fallback to backend config if safeStorage config lacks values
  const backendConfigPath = path.resolve(__dirname, '..', '..', 'backend', 'data', 'config.json')
  if (fs.existsSync(backendConfigPath)) {
    try {
      const backendRaw = JSON.parse(fs.readFileSync(backendConfigPath, 'utf-8'))
      if (!config.apiKey && backendRaw.apiKey) {
        config.apiKey = backendRaw.apiKey
      }
      if (!config.composioApiKey && backendRaw.composioApiKey) {
        config.composioApiKey = backendRaw.composioApiKey
      }
      if (!config.githubToken && backendRaw.githubToken) {
        config.githubToken = backendRaw.githubToken
      }
      if (!config.githubUsername && backendRaw.githubUsername) {
        config.githubUsername = backendRaw.githubUsername
      }
    } catch {}
  }

  return config
}

function saveConfig(newSettings) {
  const file = getConfigPath()
  const current = loadConfig()
  const merged = { ...current, ...newSettings }

  const toSave = { ...merged }
  toSave.encryptedApiKey = encryptSecret(merged.apiKey || '')
  toSave.encryptedComposioApiKey = encryptSecret(merged.composioApiKey || '')
  toSave.encryptedGithubToken = encryptSecret(merged.githubToken || '')
  delete toSave.apiKey
  delete toSave.composioApiKey
  delete toSave.githubToken

  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(toSave, null, 2), 'utf-8')

  syncBackendSettings(merged)
  return merged
}

function syncBackendSettings(settingsPayload) {
  try {
    const payload = JSON.stringify(settingsPayload)
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: 8765,
        path: '/api/settings',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 2000,
      },
      (res) => {
        res.resume()
      }
    )
    req.on('error', () => {
      // Backend may be starting; ignore
    })
    req.write(payload)
    req.end()
  } catch {}
}

function computeCornerBounds(corner, width, height, workArea) {
  const padding = 20
  let x = workArea.x + workArea.width - width - padding
  let y = workArea.y + workArea.height - height - padding

  switch (corner) {
    case 'bottom-left':
      x = workArea.x + padding
      y = workArea.y + workArea.height - height - padding
      break
    case 'top-right':
      x = workArea.x + workArea.width - width - padding
      y = workArea.y + padding
      break
    case 'top-left':
      x = workArea.x + padding
      y = workArea.y + padding
      break
    case 'bottom-right':
    default:
      x = workArea.x + workArea.width - width - padding
      y = workArea.y + workArea.height - height - padding
      break
  }
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#07080b',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#07080b', symbolColor: '#8d94a3', height: 44 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false, // Prevents socket throttling when window is hidden
    },
  })

  // Critical for keepalive: disable background throttling
  mainWindow.webContents.setBackgroundThrottling(false)

  mainWindow.once('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })

  // Window Close intercept (Section 3.2):
  // Close during Live -> Transition to Desktop Overlay Mode.
  mainWindow.on('close', (event) => {
    if (isQuitting) return
    const cfg = loadConfig()
    if (isLiveActive && cfg.overlayEnabled !== false) {
      event.preventDefault()
      mainWindow.hide()
      showOverlayWindow()
    } else {
      // Hide to tray on Windows if not quitting
      if (process.platform === 'win32' && tray) {
        event.preventDefault()
        mainWindow.hide()
      }
    }
  })

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

function createOrGetOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    return overlayWindow
  }

  const config = loadConfig()
  const primaryDisplay = screen.getPrimaryDisplay()
  const workArea = primaryDisplay.workArea
  const initialWidth = 340
  const initialHeight = 240
  const bounds = computeCornerBounds(config.overlayCorner || 'bottom-right', initialWidth, initialHeight, workArea)

  overlayWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  })

  overlayWindow.setAlwaysOnTop(true, 'screen-saver')
  overlayWindow.webContents.setBackgroundThrottling(false)

  if (config.overlayClickThrough !== false) {
    overlayWindow.setIgnoreMouseEvents(true, { forward: true })
  }

  const overlayUrl = isDev
    ? `${process.env.VITE_DEV_SERVER_URL}?mode=overlay`
    : `file://${path.join(__dirname, '..', 'dist', 'index.html')}?mode=overlay`

  overlayWindow.loadURL(overlayUrl)

  overlayWindow.once('ready-to-show', () => {
    if (isOverlayActive) {
      overlayWindow.showInactive()
      overlayWindow.webContents.send('overlay:state-update', currentLiveState)
    }
  })

  overlayWindow.on('closed', () => {
    overlayWindow = null
  })

  return overlayWindow
}

function showOverlayWindow() {
  isOverlayActive = true
  const win = createOrGetOverlayWindow()
  repositionOverlayWindow()
  if (win && !win.webContents.isLoading()) {
    win.showInactive()
    win.webContents.send('overlay:state-update', currentLiveState)
  }
  updateTrayMenu()
}

function restoreMainWindow() {
  isOverlayActive = false
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide()
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
  }
  updateTrayMenu()
}

function repositionOverlayWindow() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  const config = loadConfig()
  const primaryDisplay = screen.getPrimaryDisplay()
  const currentBounds = overlayWindow.getBounds()
  const bounds = computeCornerBounds(config.overlayCorner || 'bottom-right', currentBounds.width, currentBounds.height, primaryDisplay.workArea)
  overlayWindow.setBounds(bounds)
}

function createTray() {
  const iconPath = path.join(__dirname, '..', 'public', 'favicon.ico')
  const trayIcon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty()
  tray = new Tray(trayIcon)
  tray.setToolTip('Arix AI')
  tray.on('click', () => {
    restoreMainWindow()
  })
  updateTrayMenu()
}

function updateTrayMenu() {
  if (!tray || tray.isDestroyed()) return
  const config = loadConfig()
  const currentCorner = config.overlayCorner || 'bottom-right'
  const isClickThrough = config.overlayClickThrough !== false

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Arix AI',
      click: () => restoreMainWindow(),
    },
    { type: 'separator' },
    {
      label: 'Overlay Corner',
      submenu: [
        {
          label: 'Bottom Right',
          type: 'radio',
          checked: currentCorner === 'bottom-right',
          click: () => {
            saveConfig({ overlayCorner: 'bottom-right' })
            repositionOverlayWindow()
            updateTrayMenu()
          },
        },
        {
          label: 'Bottom Left',
          type: 'radio',
          checked: currentCorner === 'bottom-left',
          click: () => {
            saveConfig({ overlayCorner: 'bottom-left' })
            repositionOverlayWindow()
            updateTrayMenu()
          },
        },
        {
          label: 'Top Right',
          type: 'radio',
          checked: currentCorner === 'top-right',
          click: () => {
            saveConfig({ overlayCorner: 'top-right' })
            repositionOverlayWindow()
            updateTrayMenu()
          },
        },
        {
          label: 'Top Left',
          type: 'radio',
          checked: currentCorner === 'top-left',
          click: () => {
            saveConfig({ overlayCorner: 'top-left' })
            repositionOverlayWindow()
            updateTrayMenu()
          },
        },
      ],
    },
    {
      label: 'Click-Through',
      type: 'checkbox',
      checked: isClickThrough,
      click: (item) => {
        saveConfig({ overlayClickThrough: item.checked })
        if (overlayWindow && !overlayWindow.isDestroyed()) {
          overlayWindow.setIgnoreMouseEvents(item.checked, { forward: true })
        }
      },
    },
    {
      label: 'Mute Microphone',
      type: 'checkbox',
      checked: isMicMuted,
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('main:toggle-mic-mute')
        }
      },
    },
    { type: 'separator' },
    {
      label: 'End Live Session',
      enabled: isLiveActive,
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('main:end-live-session')
        }
        restoreMainWindow()
      },
    },
    {
      label: 'Quit Arix AI',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ])

  tray.setContextMenu(contextMenu)
}

function registerGlobalShortcuts() {
  try {
    globalShortcut.register('CommandOrControl+Shift+A', () => {
      if (isLiveActive) {
        if (isOverlayActive) {
          restoreMainWindow()
        } else {
          const config = loadConfig()
          if (config.overlayEnabled !== false) {
            mainWindow.hide()
            showOverlayWindow()
          }
        }
      } else {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isVisible()) {
            mainWindow.hide()
          } else {
            mainWindow.show()
            mainWindow.focus()
          }
        }
      }
    })

    // Emergency shortcut to disable click-through and restore main
    globalShortcut.register('CommandOrControl+Shift+X', () => {
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.setIgnoreMouseEvents(false)
      }
      restoreMainWindow()
    })
  } catch (err) {
    console.error('[Main] Failed to register global shortcuts:', err)
  }
}

// IPC Handlers: App & General
ipcMain.handle('app:version', () => app.getVersion())
ipcMain.handle('app:open-external', (_event, url) => {
  if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
    return shell.openExternal(url)
  }
  return false
})

ipcMain.handle('app:open-logs-folder', async () => {
  const projectRoot = path.resolve(__dirname, '..', '..')
  const logsPath = path.join(projectRoot, 'backend', 'data', 'logs')
  if (fs.existsSync(logsPath)) {
    await shell.openPath(logsPath)
    return true
  }
  const appDataLogs = path.join(app.getPath('userData'), 'logs')
  fs.mkdirSync(appDataLogs, { recursive: true })
  await shell.openPath(appDataLogs)
  return true
})

ipcMain.handle('app:reveal-in-folder', async (_event, targetPath) => {
  if (targetPath) {
    shell.showItemInFolder(targetPath)
    return true
  }
  return false
})

// IPC Handlers: Settings
ipcMain.handle('settings:get', () => loadConfig())
ipcMain.handle('settings:set', (_event, patch) => {
  const res = saveConfig(patch)
  updateTrayMenu()
  repositionOverlayWindow()
  return res
})
ipcMain.handle('settings:getApiKey', () => loadConfig().apiKey)
ipcMain.handle('settings:setApiKey', (_event, apiKey) => {
  const cfg = loadConfig()
  cfg.apiKey = apiKey
  return saveConfig(cfg)
})
ipcMain.handle('settings:reset', () => {
  return saveConfig({ ...defaultSettings, apiKey: '' })
})

ipcMain.handle('settings:testApiKey', async (_event, apiKey) => {
  const key = apiKey || loadConfig().apiKey
  if (!key) return { ok: false, message: 'No API key provided' }
  return new Promise((resolve) => {
    const payload = JSON.stringify({ apiKey: key })
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: 8765,
        path: '/api/settings/test-key',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 5000,
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          try {
            resolve(JSON.parse(data))
          } catch {
            resolve({ ok: res.statusCode === 200, message: `Status: ${res.statusCode}` })
          }
        })
      }
    )
    req.on('error', (err) => {
      resolve({ ok: false, message: `Cannot reach local backend: ${err.message}` })
    })
    req.write(payload)
    req.end()
  })
})

// IPC Handlers: Dialogs & Folders
ipcMain.handle('dialog:openDirectory', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const result = await dialog.showOpenDialog(win || undefined, {
    title: 'Select Project Directory',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

// IPC Handlers: Screen Capture
ipcMain.handle('desktopCapturer:getSources', async (_event, opts) => {
  try {
    const sources = await desktopCapturer.getSources(opts || { types: ['screen', 'window'] })
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnailDataUrl: s.thumbnail.toDataURL(),
    }))
  } catch (err) {
    console.error('[Main] desktopCapturer error:', err)
    return []
  }
})

// IPC Handlers: Overlay Mode Communication (Section 3, 5, 6)
ipcMain.handle('main:broadcast-live-state', (_event, payload) => {
  currentLiveState = { ...currentLiveState, ...payload }
  isLiveActive = payload.status !== 'offline'
  if (payload.isMuted !== undefined) {
    isMicMuted = Boolean(payload.isMuted)
  }

  // Forward to overlay window if open
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('overlay:state-update', currentLiveState)
  }
  updateTrayMenu()
  return true
})

ipcMain.handle('overlay:restore-main', () => {
  restoreMainWindow()
  return true
})

ipcMain.handle('overlay:resize', (_event, targetWidth, targetHeight) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    const clampedW = Math.min(Math.max(280, Math.round(targetWidth)), 460)
    const clampedH = Math.min(Math.max(220, Math.round(targetHeight)), 460)
    const config = loadConfig()
    const primaryDisplay = screen.getPrimaryDisplay()
    const bounds = computeCornerBounds(config.overlayCorner || 'bottom-right', clampedW, clampedH, primaryDisplay.workArea)
    overlayWindow.setBounds(bounds)
  }
  return true
})

ipcMain.handle('overlay:set-ignore-mouse-events', (_event, ignore, options) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setIgnoreMouseEvents(Boolean(ignore), options || { forward: true })
  }
  return true
})

ipcMain.handle('overlay:permission-decision', (_event, callId, approved) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('main:permission-decision-from-overlay', { callId, approved })
  }
  return true
})

app.whenReady().then(() => {
  // Sync initial settings to backend on boot
  const initial = loadConfig()
  syncBackendSettings(initial)

  createMainWindow()
  createTray()
  registerGlobalShortcuts()

  screen.on('display-metrics-changed', () => {
    repositionOverlayWindow()
  })

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createMainWindow()
    } else {
      mainWindow.show()
    }
  })
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
