import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('which', () => ({ default: { sync: vi.fn() } }))
import which from 'which'
import { resolveLauncher } from './resolveLauncher'

const whichSync = (which as unknown as { sync: ReturnType<typeof vi.fn> }).sync

beforeEach(() => whichSync.mockReset())

describe('resolveLauncher (win32)', () => {
  it('prefere o .cmd e roda via cmd.exe /c', () => {
    whichSync.mockReturnValue(['C:\\bin\\claude', 'C:\\bin\\claude.cmd'])
    const r = resolveLauncher('claude', ['--help'], 'win32', { ComSpec: 'C:\\Windows\\System32\\cmd.exe' })
    expect(r.file.toLowerCase()).toContain('cmd.exe')
    expect(r.args).toEqual(['/d', '/s', '/c', 'C:\\bin\\claude.cmd', '--help'])
  })
  it('nunca escolhe o shim sem extensão', () => {
    whichSync.mockReturnValue(['C:\\bin\\claude'])
    const r = resolveLauncher('claude', [], 'win32', { ComSpec: 'cmd.exe' })
    expect(r.args).toContain('C:\\bin\\claude.cmd') // fallback para <bin>.cmd
  })
})

describe('resolveLauncher (posix)', () => {
  it('roda via login shell -lc', () => {
    const r = resolveLauncher('claude', ['x'], 'linux', { SHELL: '/bin/zsh' })
    expect(r.file).toBe('/bin/zsh')
    expect(r.args).toEqual(['-lc', 'claude x'])
  })
})
