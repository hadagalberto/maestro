import type { ProfileEntry } from './types'

const oneShot = (args: string[]): ProfileEntry['discuss'] => ({ argsTemplate: args })

export const PROFILE_PRESETS: Record<string, ProfileEntry> = {
  claude:   { command: 'claude',   args: [], color: '#d97757', discuss: oneShot(['-p', '{{prompt}}']) },
  codex:    { command: 'codex',    args: [], color: '#10a37f', discuss: oneShot(['exec', '{{prompt}}']) },
  antigravity: { command: 'agy', args: [], color: '#00c2a8', discuss: oneShot(['-p', '{{prompt}}']) },
  opencode: { command: 'opencode', args: [], color: '#f59e0b', discuss: oneShot(['-p', '{{prompt}}']) },
  amp:      { command: 'amp',      args: [], color: '#8b5cf6', discuss: oneShot(['-p', '{{prompt}}']) },
  shell: {
    command: process.platform === 'win32' ? 'powershell.exe' : 'bash',
    args: [], color: '#6e7681',
  },
}
