import { app, BrowserWindow, Menu, session, Notification } from 'electron'
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
import { AgentTree } from './queen/agentTree'
import { GitService } from './git/gitService'
import { FileService } from './files/fileService'
import { PinsStore } from './pins/pinsStore'
import { discussionEventChannel, type ProjectState } from '@shared/ipc'
import type { QueenInfo } from '@shared/queen'
import { randomUUID } from 'node:crypto'
import { projectPathFromArgs, userArgs } from './cliArgs'

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
  emit: (id, ev) => {
    if (win && !win.webContents.isDestroyed()) win.webContents.send(discussionEventChannel(id), ev)
    if (ev.type === 'status' && ev.status === 'done') maybeNotify('Maestro — discussão concluída', discussionStore.get(id)?.topic ?? 'discussão')
  },
  now: () => Date.now(),
  ids: () => randomUUID(),
})
const mailbox = new Mailbox()
const agentTree = new AgentTree()
const git = new GitService()
const files = new FileService()
const pins = new PinsStore()
const emitPinsChanged = () => { if (win && !win.webContents.isDestroyed()) win.webContents.send('pins:changed') }
ptyHost.onExit = (id, code) => {
  const node = agentTree.get(id)
  const r = agentTree.markExited(id, code)
  if (r?.parentId) {
    mailbox.send({ from: 'system', to: r.parentId, text: `agent ${id} exited (code ${code})` })
    maybeNotify('Maestro — agente concluiu', `${node?.name ?? id} (code ${code})`)
  }
}
const bridge = new RendererBridge(() => win?.webContents ?? null)
let queen: QueenHandle | null = null
function queenInfo(): QueenInfo {
  return { running: queen != null, url: queen?.url ?? null, port: queen?.port ?? null, token: queen?.token ?? null }
}

// OS notification gated centrally: respeita o toggle e só notifica em background.
function maybeNotify(title: string, body: string): void {
  if (!config.get().settings.taskNotify) return
  if (win?.isFocused()) return
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body })
  n.on('click', () => { win?.show(); win?.focus() })
  n.show()
}

function appIcon(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../build/icon.png')
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1400, height: 900, show: false, backgroundColor: '#0d1117', icon: appIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
    },
  })
  win.once('ready-to-show', () => win?.show())
  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(DEV_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

function openProjectFromArgs(argv: string[], cwd: string): void {
  const p = projectPathFromArgs(userArgs(argv, app.isPackaged), cwd)
  if (p) { try { project.open(p) } catch { /* pasta inválida: ignora */ } }
}

// Instância única: `maestro <pasta>` numa segunda invocação foca a janela existente
// e abre a pasta, em vez de subir um segundo app.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) app.quit()
app.on('second-instance', (_e, argv, cwd) => {
  if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus() }
  openProjectFromArgs(argv, cwd)
})

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return
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
    agentTree,
    pins,
    onPinsChanged: emitPinsChanged,
  })
  // publish url+token for agents/users (the panel references this file)
  try {
    const queenFile = join(app.getPath('userData'), 'queen.json')
    writeFileSync(queenFile, JSON.stringify({ url: queen.url, token: queen.token }, null, 2), { mode: 0o600 })
  } catch { /* non-fatal */ }
  registerIpc({
    config, ptyHost, project, discussion, discussionStore, agentTree,
    isTrustedSender: makeSenderGuard(DEV_URL, app.isPackaged),
    scrollback: { save: (id, data) => scrollbackMem.set(id, data), load: (id) => scrollbackMem.get(id) ?? null },
    queenInfo,
    bridge,
    git,
    files,
    pins,
    emitPinsChanged,
    currentProjectRoot: () => config.get().currentProject,
    suggestProfile: () => {
      const entries = project.effectiveEntries()
      const e = entries['claude'] ?? Object.values(entries).find((x) => x.discuss)
      if (!e?.discuss) return null
      return { command: e.command, args: [...(e.args ?? []), ...e.discuss.argsTemplate] }
    },
    notifyTask: maybeNotify,
  })
  Menu.setApplicationMenu(null)
  createWindow()
  openProjectFromArgs(process.argv, process.cwd())
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('before-quit', () => {
  ptyHost.dispose(); project.stop(); discussion.abortAll(); void queen?.close()
  try { rmSync(join(app.getPath('userData'), 'queen.json'), { force: true }) } catch { /* ignore */ }
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
