import { ipcMain, shell, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { schemaByChannel } from '@shared/schemas'
import type { IpcChannel, IpcRequest } from '@shared/ipc'
import { ConfigStore } from './configStore'
import { PtyHostBridge } from './ptyHostBridge'

export interface RouterDeps {
  config: ConfigStore
  ptyHost: PtyHostBridge
  isTrustedSender: (e: IpcMainInvokeEvent) => boolean
  scrollback: { save: (id: string, data: string) => void; load: (id: string) => string | null }
}

type Handler<C extends IpcChannel> =
  (args: IpcRequest[C]['args'], e: IpcMainInvokeEvent) => IpcRequest[C]['result'] | Promise<IpcRequest[C]['result']>

export function registerIpc(deps: RouterDeps): void {
  const handle = <C extends IpcChannel>(channel: C, fn: Handler<C>) => {
    ipcMain.handle(channel, (e, raw) => {
      if (!deps.isTrustedSender(e)) throw new Error('untrusted sender')
      const schema = (schemaByChannel as Record<string, { parse: (v: unknown) => unknown } | undefined>)[channel]
      const args = schema ? schema.parse(raw) : raw
      return fn(args as IpcRequest[C]['args'], e)
    })
  }

  handle('pty:create', (a) => { deps.ptyHost.spawn(a) })
  handle('pty:write', (a) => { deps.ptyHost.write(a.id, a.data) })
  handle('pty:resize', (a) => { deps.ptyHost.resize(a.id, a.cols, a.rows) })
  handle('pty:kill', (a) => { deps.ptyHost.kill(a.id) })
  handle('config:get', () => deps.config.get())
  handle('config:set', (a) => { deps.config.set(a.patch) })
  handle('scrollback:save', (a) => { deps.scrollback.save(a.id, a.data) })
  handle('scrollback:load', (a) => deps.scrollback.load(a.id))
  handle('shell:openExternal', (a) => { void shell.openExternal(a.url) })
}

/** allowlist síncrona do sender: file:// próprio (packaged) ou dev server */
export function makeSenderGuard(devUrl: string, isPackaged: boolean) {
  return (e: IpcMainInvokeEvent): boolean => {
    const url = e.senderFrame?.url
    if (!url) return false
    if (isPackaged) return url.startsWith('file://')
    return url.startsWith(devUrl) || url.startsWith('file://')
  }
}

export type { WebContents }
