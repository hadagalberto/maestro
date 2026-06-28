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
  source: 'preset' | 'global' | 'project'
}

export interface TrustConfig { trustedFolders: string[]; deniedFolders: string[] }

export interface AppConfig {
  schemaVersion: number
  activeLayout: LayoutKind
  panes: PaneConfig[]
  layoutSizes: Record<string, number[]>
  settings: { fontFamily: string; fontSize: number; scrollback: number; theme: 'system' | 'light' | 'dark' }
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
  settings: { fontFamily: 'JetBrains Mono, monospace', fontSize: 13, scrollback: 5000, theme: 'system' },
  globalProfiles: {},
  recentProjects: [],
  currentProject: null,
  trust: { trustedFolders: [], deniedFolders: [] },
}

export type ConfigProblem =
  | { kind: 'syntax'; line: number; col: number; message: string }
  | { kind: 'schema'; path: string; message: string }
