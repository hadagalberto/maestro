import { app, BrowserWindow, session } from 'electron'
import { join } from 'node:path'
import { ConfigStore } from './configStore'
import { PtyHostBridge } from './ptyHostBridge'
import { registerIpc, makeSenderGuard } from './ipcRouter'

const DEV_URL = process.env['ELECTRON_RENDERER_URL'] ?? 'http://localhost:5173'
const scrollbackMem = new Map<string, string>()

let win: BrowserWindow | null = null
const config = new ConfigStore()
const ptyHost = new PtyHostBridge(() => win?.webContents ?? null)

function createWindow(): void {
  win = new BrowserWindow({
    width: 1400, height: 900, show: false, backgroundColor: '#0d1117',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
    },
  })
  win.once('ready-to-show', () => win?.show())
  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(DEV_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((d, cb) =>
    cb({ responseHeaders: {
      ...d.responseHeaders,
      'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://localhost:5173"],
    } }),
  )
  ptyHost.start()
  registerIpc({
    config, ptyHost,
    isTrustedSender: makeSenderGuard(DEV_URL, app.isPackaged),
    scrollback: {
      save: (id, data) => scrollbackMem.set(id, data),
      load: (id) => scrollbackMem.get(id) ?? null,
    },
  })
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('before-quit', () => ptyHost.dispose())
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
