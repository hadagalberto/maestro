import type { AppConfig, PaneConfig } from './types'

/** request/response channels: invoke(channel, args) -> result */
export interface IpcRequest {
  'pty:create': { args: { id: string; command: string; args?: string[]; cwd: string; env?: Record<string,string>; cols: number; rows: number }; result: void }
  'pty:write':  { args: { id: string; data: string }; result: void }
  'pty:resize': { args: { id: string; cols: number; rows: number }; result: void }
  'pty:kill':   { args: { id: string }; result: void }
  'config:get': { args: undefined; result: AppConfig }
  'config:set': { args: { patch: Partial<AppConfig> }; result: void }
  'scrollback:save': { args: { id: string; data: string }; result: void }
  'scrollback:load': { args: { id: string }; result: string | null }
  'shell:openExternal': { args: { url: string }; result: void }
}
export type IpcChannel = keyof IpcRequest

/** push channels: main -> renderer. pty:data/pty:exit são namespaced por id no nome do canal */
export interface IpcEventPayloads {
  'pty:data': { data: string }
  'pty:exit': { code: number; reason?: string }
}
export const ptyDataChannel = (id: string) => `pty:data:${id}` as const
export const ptyExitChannel = (id: string) => `pty:exit:${id}` as const

export type { AppConfig, PaneConfig }
