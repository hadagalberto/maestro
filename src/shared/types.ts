export type LayoutKind = 'two' | 'three' | 'quad'

export interface PaneConfig {
  id: string
  name: string
  command: string
  args?: string[]
  cwd: string
  env?: Record<string, string>
  color?: string
  profileId?: string
  origin?: 'user' | 'project'
  projectRoot?: string
  parentId?: string
  autoRestart?: boolean
}

// Shape stored in maestro.yml profiles and in globalProfiles. name defaults to the map key.
export interface ProfileEntry {
  name?: string
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  autoStart?: boolean
  color?: string
  disabled?: boolean
  autoRestart?: boolean
  discuss?: { argsTemplate: string[]; stdin?: boolean; captureMode?: 'pipe' | 'pty'; timeoutMs?: number }
}

// Resolved profile presented to the renderer.
export interface Profile {
  id: string
  name: string
  command: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
  autoStart: boolean
  color?: string
  disabled?: boolean
  autoRestart?: boolean
  source: 'preset' | 'global' | 'project'
}

export interface TrustConfig { trustedFolders: string[]; deniedFolders: string[] }

export interface AppConfig {
  schemaVersion: number
  activeLayout: LayoutKind
  panes: PaneConfig[]
  layoutSizes: Record<string, number[]>
  settings: { fontFamily: string; fontSize: number; scrollback: number; theme: 'system' | 'light' | 'dark'; taskNotify: boolean }
  globalProfiles: Record<string, ProfileEntry>
  recentProjects: string[]
  currentProject: string | null
  trust: TrustConfig
}

export const DEFAULT_CONFIG: AppConfig = {
  schemaVersion: 2,
  activeLayout: 'two',
  panes: [],
  layoutSizes: {},
  settings: { fontFamily: 'JetBrains Mono, monospace', fontSize: 13, scrollback: 5000, theme: 'system', taskNotify: true },
  globalProfiles: {},
  recentProjects: [],
  currentProject: null,
  trust: { trustedFolders: [], deniedFolders: [] },
}

// Patch aceito por config:set / ConfigStore.set — settings pode ser parcial (merge no store).
export type ConfigPatch = Partial<Omit<AppConfig, 'settings'>> & { settings?: Partial<AppConfig['settings']> }

export type ConfigProblem =
  | { kind: 'syntax'; line: number; col: number; message: string }
  | { kind: 'schema'; path: string; message: string }
