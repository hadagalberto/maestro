import { ipcMain, shell, dialog, type IpcMainInvokeEvent } from 'electron'
import { schemaByChannel } from '@shared/schemas'
import { TRUST_REQUIRED, type IpcChannel, type IpcRequest, type ProjectState } from '@shared/ipc'
import { ConfigStore } from './configStore'
import { PtyHostBridge } from './ptyHostBridge'
import { ProjectManager } from './projectManager'
import { scaffoldMaestroConfig } from './maestroConfig'
import { isTrusted, canonical } from './trust'
import { DiscussionRunner } from './discussion/discussionRunner'
import { DiscussionStore } from './discussion/discussionStore'

export interface RouterDeps {
  config: ConfigStore
  ptyHost: PtyHostBridge
  project: ProjectManager
  discussion: DiscussionRunner
  discussionStore: DiscussionStore
  isTrustedSender: (e: IpcMainInvokeEvent) => boolean
  scrollback: { save: (id: string, data: string) => void; load: (id: string) => string | null }
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
  })
  handle('pty:write', (a) => { deps.ptyHost.write(a.id, a.data) })
  handle('pty:resize', (a) => { deps.ptyHost.resize(a.id, a.cols, a.rows) })
  handle('pty:kill', (a) => { deps.ptyHost.kill(a.id) })
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
}

export function makeSenderGuard(devUrl: string, isPackaged: boolean) {
  return (e: IpcMainInvokeEvent): boolean => {
    const url = e.senderFrame?.url
    if (!url) return false
    if (isPackaged) return url.startsWith('file://')
    return url.startsWith(devUrl) || url.startsWith('file://')
  }
}
