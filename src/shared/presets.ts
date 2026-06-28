import type { ProfileEntry } from './types'

// Built-in profile templates. Keyed by id. name defaults to id when omitted.
export const PROFILE_PRESETS: Record<string, ProfileEntry> = {
  claude:   { command: 'claude',   args: [], color: '#d97757' },
  codex:    { command: 'codex',    args: [], color: '#10a37f' },
  opencode: { command: 'opencode', args: [], color: '#f59e0b' },
  amp:      { command: 'amp',      args: [], color: '#8b5cf6' },
  shell: {
    command: process.platform === 'win32' ? 'powershell.exe' : 'bash',
    args: [], color: '#6e7681',
  },
}
