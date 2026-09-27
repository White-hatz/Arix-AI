const { app, BrowserWindow, ipcMain, shell, safeStorage, dialog, desktopCapturer } = require('electron')
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

function createWindow() {
  const window = new BrowserWindow({
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
      sandbox: false, // needed for safeStorage and desktopCapturer IPC
    },
  })

  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    window.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
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

// IPC Handlers: Settings (Phase 0)
ipcMain.handle('settings:get', () => loadConfig())
ipcMain.handle('settings:set', (_event, patch) => saveConfig(patch))
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

// IPC Handlers: Dialogs & Folders (Phase 1)
ipcMain.handle('dialog:openDirectory', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const result = await dialog.showOpenDialog(win || undefined, {
    title: 'Select Project Directory',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

// IPC Handlers: Screen Capture (Phase 3.4)
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

app.whenReady().then(() => {
  // Sync initial settings to backend on boot
  const initial = loadConfig()
  syncBackendSettings(initial)

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
