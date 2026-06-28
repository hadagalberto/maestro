import type { AppConfig, PaneConfig, Profile, ConfigProblem, ProfileEntry } from './types'
import type { Discussion, DiscussionEvent, TemplateKind } from './discussion/types'
import type { QueenInfo } from './queen'

export interface ProjectState {
  currentProject: string | null
  recentProjects: string[]
  trusted: boolean
  profiles: Profile[]
  problems: ConfigProblem[]
  hasMaestroFile: boolean
}

export interface IpcRequest {
  'pty:create': { args: { id: string; command: string; args?: string[]; cwd: string; env?: Record<string,string>; cols: number; rows: number; origin?: 'user'|'project'; projectRoot?: string; name?: string; parentId?: string }; result: void }
  'pty:write':  { args: { id: string; data: string }; result: void }
  'pty:resize': { args: { id: string; cols: number; rows: number }; result: void }
  'pty:kill':   { args: { id: string }; result: void }
  'config:get': { args: undefined; result: AppConfig }
  'config:set': { args: { patch: Partial<AppConfig> }; result: void }
  'scrollback:save': { args: { id: string; data: string }; result: void }
  'scrollback:load': { args: { id: string }; result: string | null }
  'shell:openExternal': { args: { url: string }; result: void }
  'project:open': { args: undefined; result: ProjectState | null }      // dialog; null if cancelled
  'project:openPath': { args: { path: string }; result: ProjectState }
  'project:state': { args: undefined; result: ProjectState }
  'profiles:setGlobal': { args: { profiles: Record<string, ProfileEntry> }; result: ProjectState }
  'maestro:scaffold': { args: { path: string }; result: ProjectState }
  'trust:get': { args: { path: string }; result: boolean }
  'trust:grant': { args: { path: string }; result: ProjectState }
  'trust:grantParent': { args: { path: string }; result: ProjectState }
  'trust:revoke': { args: { path: string }; result: ProjectState }
  'discussion:start': { args: { topic: string; templateKind: TemplateKind; orchestratorProfileId: string; participantProfileIds: string[]; autonomous: boolean }; result: { id: string } }
  'discussion:list': { args: undefined; result: Discussion[] }
  'discussion:get': { args: { id: string }; result: Discussion | null }
  'discussion:abort': { args: { id: string }; result: void }
  'discussion:delete': { args: { id: string }; result: void }
  'discussion:approve': { args: { id: string; approve: boolean }; result: void }
  'queen:info': { args: undefined; result: QueenInfo }
}
export type IpcChannel = keyof IpcRequest

export interface IpcEventPayloads {
  'pty:data': { data: string }
  'pty:exit': { code: number; reason?: string }
}
export const ptyDataChannel = (id: string) => `pty:data:${id}` as const
export const ptyExitChannel = (id: string) => `pty:exit:${id}` as const

// app-wide push events (main -> renderer), fixed channel names
export type AppEvent = 'project:changed'
export interface AppEventPayloads { 'project:changed': ProjectState }

export const TRUST_REQUIRED = 'TRUST_REQUIRED'

export const discussionEventChannel = (id: string) => `discussion:event:${id}` as const
export interface IpcEventById { 'discussion:event': DiscussionEvent }

export type { AppConfig, PaneConfig, Profile, ConfigProblem, ProfileEntry }
export type { Discussion, DiscussionEvent, TemplateKind }
export type { QueenInfo } from './queen'
