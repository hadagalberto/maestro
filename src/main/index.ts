import { app, BrowserWindow, session, Notification } from 'electron'
import { join } from 'node:path'
import { writeFileSync, rmSync } from 'node:fs'
import { ConfigStore } from './configStore'
import { PtyHostBridge } from './ptyHostBridge'
import { ProjectManager } from './projectManager'
import { registerIpc, makeSenderGuard } from './ipcRouter'
import { DiscussionStore } from './discussion/discussionStore'
import { DiscussionRunner } from './discussion/discussionRunner'
import { CliAdapter } from './discussion/cliAdapter'
import { isTrusted } from './trust'
import { startQueen, type QueenHandle } from './queen/server'
import { RendererBridge } from './queen/rendererBridge'
import { Mailbox } from './queen/mailbox'
import { discussionEventChannel, type ProjectState } from '@shared/ipc'
import type { QueenInfo } from '@shared/queen'
import { randomUUID } from 'node:crypto'

const DEV_URL = process.env['ELECTRON_RENDERER_URL'] ?? 'http://localhost:5173'
const scrollbackMem = new Map<string, string>()

let win: BrowserWindow | null = null
const config = new ConfigStore()
const ptyHost = new PtyHostBridge(() => win?.webContents ?? null)
const project = new ProjectManager(config, (s: ProjectState) => {
  if (win && !win.webContents.isDestroyed()) win.webContents.send('project:changed', s)
})
const discussionStore = new DiscussionStore()
const discussion = new DiscussionRunner({
  store: discussionStore,
  makeAdapter: () => new CliAdapter((pid) => project.effectiveEntries()[pid]),
  projectProfileIds: () => project.projectEntryIds(),
  projectRoot: () => config.get().currentProject,
  isTrusted: (root) => isTrusted(root, config.get().trust),
  emit: (id, ev) => { if (win && !win.webContents.isDestroyed()) win.webContents.send(discussionEventChannel(id), ev) },
  now: () => Date.now(),
  ids: () => randomUUID(),
})
const mailbox = new Mailbox()
const bridge = new RendererBridge(() => win?.webContents ?? null)
let queen: QueenHandle | null = null
function queenInfo(): QueenInfo {
  return { running: queen != null, url: queen?.url ?? null, port: queen?.port ?? null, token: queen?.token ?? null }
}

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

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onHeadersReceived((d, cb) =>
    cb({ responseHeaders: { ...d.responseHeaders,
      'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://localhost:5173"],
    } }),
  )
  ptyHost.start()
  queen = await startQueen({
    discussionRunner: discussion,
    discussionStore,
    effectiveEntries: () => project.effectiveEntries(),
    currentProject: () => config.get().currentProject,
    isTrusted: (root) => isTrusted(root, config.get().trust),
    mailbox,
    bridge,
    notify: (title, body) => { new Notification({ title, body }).show() },
  })
  // publish url+token for agents/users (the panel references this file)
  try {
    const queenFile = join(app.getPath('userData'), 'queen.json')
    writeFileSync(queenFile, JSON.stringify({ url: queen.url, token: queen.token }, null, 2), { mode: 0o600 })
  } catch { /* non-fatal */ }
  registerIpc({
    config, ptyHost, project, discussion, discussionStore,
    isTrustedSender: makeSenderGuard(DEV_URL, app.isPackaged),
    scrollback: { save: (id, data) => scrollbackMem.set(id, data), load: (id) => scrollbackMem.get(id) ?? null },
    queenInfo,
    bridge,
  })
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('before-quit', () => {
  ptyHost.dispose(); project.stop(); discussion.abortAll(); void queen?.close()
  try { rmSync(join(app.getPath('userData'), 'queen.json'), { force: true }) } catch { /* ignore */ }
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
