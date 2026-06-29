import { ipcMain, shell, dialog, type IpcMainInvokeEvent } from 'electron'
import { schemaByChannel } from '@shared/schemas'
import { TRUST_REQUIRED, type IpcChannel, type IpcRequest, type ProjectState } from '@shared/ipc'
import type { QueenInfo, QueenResponse } from '@shared/queen'
import { ConfigStore } from './configStore'
import { PtyHostBridge } from './ptyHostBridge'
import { ProjectManager } from './projectManager'
import { scaffoldMaestroConfig } from './maestroConfig'
import { isTrusted, canonical } from './trust'
import { DiscussionRunner } from './discussion/discussionRunner'
import { DiscussionStore } from './discussion/discussionStore'
import type { AgentTree } from './queen/agentTree'
import type { GitService } from './git/gitService'
import type { FileService } from './files/fileService'
import type { PinsStore } from './pins/pinsStore'

export interface RouterDeps {
  config: ConfigStore
  ptyHost: PtyHostBridge
  project: ProjectManager
  discussion: DiscussionRunner
  discussionStore: DiscussionStore
  agentTree: AgentTree
  isTrustedSender: (e: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => boolean
  scrollback: { save: (id: string, data: string) => void; load: (id: string) => string | null }
  queenInfo: () => QueenInfo
  bridge: { handleResponse: (r: QueenResponse) => void }
  git: GitService
  files: FileService
  pins: PinsStore
  emitPinsChanged: () => void
  currentProjectRoot: () => string | null
  suggestProfile: () => { command: string; args: string[] } | null   // AI cmd+args for commit suggestion
}

type Handler<C extends IpcChannel> = (args: IpcRequest[C]['args'], e: IpcMainInvokeEvent) => IpcRequest[C]['result'] | Promise<IpcRequest[C]['result']>

export function registerIpc(deps: RouterDeps): void {
  const handle = <C extends IpcChannel>(channel: C, fn: Handler<C>) => {
    ipcMain.handle(channel, (e, raw) => {
      if (!deps.isTrustedSender(e)) throw new Error('untrusted sender')
      const schema = (schemaByChannel as Record<string, { parse: (v: unknown) => unknown } | undefined>)[channel]
      const args = schema ? schema.parse(raw) : raw
      return fn(args as IpcRequest[C]['args'], e)
    })
  }

  handle('pty:create', (a) => {
    if (a.origin === 'project') {
      const root = a.projectRoot ?? a.cwd
      if (!isTrusted(root, deps.config.get().trust)) {
        const err = new Error(TRUST_REQUIRED) as Error & { code?: string; projectRoot?: string }
        err.code = TRUST_REQUIRED; err.projectRoot = canonical(root); throw err
      }
    }
    deps.ptyHost.spawn(a)
    deps.agentTree.open({ id: a.id, name: a.name ?? a.command, command: a.command, parentId: a.parentId })
  })
  handle('pty:write', (a) => { deps.ptyHost.write(a.id, a.data) })
  handle('pty:resize', (a) => { deps.ptyHost.resize(a.id, a.cols, a.rows) })
  handle('pty:kill', (a) => { deps.ptyHost.kill(a.id); deps.agentTree.close(a.id) })
  handle('config:get', () => deps.config.get())
  handle('config:set', (a) => { deps.config.set(a.patch) })
  handle('scrollback:save', (a) => { deps.scrollback.save(a.id, a.data) })
  handle('scrollback:load', (a) => deps.scrollback.load(a.id))
  handle('shell:openExternal', (a) => { void shell.openExternal(a.url) })

  handle('project:open', async (): Promise<ProjectState | null> => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    return deps.project.open(r.filePaths[0])
  })
  handle('project:openPath', (a) => deps.project.open(a.path))
  handle('project:state', () => deps.project.state())
  handle('profiles:setGlobal', async (a) => { deps.config.setGlobalProfiles(a.profiles); return deps.project.state() })
  handle('maestro:scaffold', async (a) => { await scaffoldMaestroConfig(deps.project.maestroPath(a.path)); return deps.project.state() })
  handle('trust:get', (a) => isTrusted(a.path, deps.config.get().trust))
  handle('trust:grant', async (a) => { deps.config.grantTrust(canonical(a.path)); return deps.project.state() })
  handle('trust:grantParent', async (a) => {
    const parent = canonical(a.path).split(/[\\/]/).slice(0, -1).join('/') || canonical(a.path)
    deps.config.grantTrust(parent); return deps.project.state()
  })
  handle('trust:revoke', async (a) => { deps.config.revokeTrust(canonical(a.path)); return deps.project.state() })

  handle('discussion:start', (a) => deps.discussion.start(a))
  handle('discussion:list', () => deps.discussionStore.list())
  handle('discussion:get', (a) => deps.discussionStore.get(a.id))
  handle('discussion:abort', (a) => { deps.discussion.abort(a.id) })
  handle('discussion:delete', (a) => { deps.discussion.abort(a.id); deps.discussionStore.delete(a.id) })
  handle('discussion:approve', (a) => { deps.discussion.approve(a.id, a.approve) })

  handle('queen:info', () => deps.queenInfo())
  ipcMain.on('queen:res', (e, r) => { if (deps.isTrustedSender(e)) deps.bridge.handleResponse(r) })

  const root = () => deps.currentProjectRoot()
  const noRoot = { ok: false, message: 'nenhum projeto aberto' }
  handle('git:status', async () => { const r = root(); return r ? deps.git.status(r) : { isRepo: false, branch: null, ahead: 0, behind: 0, staged: [], unstaged: [], hasRemote: false } })
  handle('git:diff', async (a) => { const r = root(); return r ? deps.git.diff(r, a.file, a.staged) : '' })
  handle('git:stage', async (a) => { const r = root(); return r ? deps.git.stage(r, a.file) : noRoot })
  handle('git:unstage', async (a) => { const r = root(); return r ? deps.git.unstage(r, a.file) : noRoot })
  handle('git:commit', async (a) => { const r = root(); return r ? deps.git.commit(r, a.message) : noRoot })
  handle('git:push', async () => { const r = root(); return r ? deps.git.push(r) : noRoot })
  handle('git:createPR', async (a) => { const r = root(); return r ? deps.git.createPR(r, a.title, a.body) : { ok: false, message: 'nenhum projeto aberto' } })
  handle('git:suggestCommit', async () => {
    const r = root(); if (!r) return { message: '' }
    const p = deps.suggestProfile(); if (!p) return { message: '' }
    return { message: await deps.git.suggestCommit(r, p.command, p.args) }
  })

  handle('files:list', async () => { const r = deps.currentProjectRoot(); return r ? deps.files.listFiles(r) : [] })
  handle('files:search', async (a) => { const r = deps.currentProjectRoot(); if (!r) return []; try { return await deps.files.search(r, a.query, a.opts) } catch { return [] } })
  handle('files:read', async (a) => { const r = deps.currentProjectRoot(); return r ? deps.files.read(r, a.path) : { path: a.path, content: '', truncated: false, binary: false } })

  const proot = () => deps.currentProjectRoot()
  const pinsChanged = () => deps.emitPinsChanged()
  handle('pins:list', () => { const r = proot(); return r ? deps.pins.listPins(r) : [] })
  handle('pins:create', (a) => { const r = proot(); if (r) { deps.pins.createPin(r, a.text, a.terminalId); pinsChanged() } return r ? deps.pins.listPins(r) : [] })
  handle('pins:update', (a) => { const r = proot(); if (r) { deps.pins.updatePin(r, a.id, a.text); pinsChanged() } return r ? deps.pins.listPins(r) : [] })
  handle('pins:setDone', (a) => { const r = proot(); if (r) { deps.pins.setPinDone(r, a.id, a.done); pinsChanged() } return r ? deps.pins.listPins(r) : [] })
  handle('pins:delete', (a) => { const r = proot(); if (r) { deps.pins.deletePin(r, a.id); pinsChanged() } return r ? deps.pins.listPins(r) : [] })
  handle('notes:get', () => { const r = proot(); return r ? deps.pins.getNotes(r) : '' })
  handle('notes:set', (a) => { const r = proot(); if (r) { deps.pins.setNotes(r, a.notes); pinsChanged() } })
  handle('notes:append', (a) => { const r = proot(); if (r) { deps.pins.appendNotes(r, a.chunk); pinsChanged() } })
}

export function makeSenderGuard(devUrl: string, isPackaged: boolean) {
  return (e: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): boolean => {
    const url = e.senderFrame?.url
    if (!url) return false
    if (isPackaged) return url.startsWith('file://')
    return url.startsWith(devUrl) || url.startsWith('file://')
  }
}
