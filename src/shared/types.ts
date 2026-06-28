export type LayoutKind = 'two' | 'three' | 'quad'

export interface PaneConfig {
  id: string            // terminalId (uuid)
  name: string          // label exibido
  command: string       // ex: 'claude', 'codex', 'bash'
  args?: string[]
  cwd: string
  env?: Record<string, string>
}

export interface AppConfig {
  schemaVersion: number
  activeLayout: LayoutKind
  panes: PaneConfig[]                       // terminais abertos
  layoutSizes: Record<string, number[]>     // groupId -> sizes (%)
  settings: {
    fontFamily: string
    fontSize: number
    scrollback: number
    theme: 'system' | 'light' | 'dark'
  }
}

export const DEFAULT_CONFIG: AppConfig = {
  schemaVersion: 1,
  activeLayout: 'two',
  panes: [],
  layoutSizes: {},
  settings: { fontFamily: 'JetBrains Mono, monospace', fontSize: 13, scrollback: 5000, theme: 'system' },
}
