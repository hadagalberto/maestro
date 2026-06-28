import { describe, it, expect } from 'vitest'
import { maestroConfigSchema, ptyCreate, profileEntrySchema } from './schemas'
import { configSet } from './schemas'

describe('maestroConfigSchema', () => {
  it('aceita config válido e aplica defaults', () => {
    const r = maestroConfigSchema.safeParse({ version: 1, profiles: { claude: { command: 'claude' } } })
    expect(r.success).toBe(true)
    if (r.success) { expect(r.data.profiles.claude.args).toEqual([]); expect(r.data.profiles.claude.autoStart).toBe(false) }
  })
  it('rejeita version != 1', () => {
    expect(maestroConfigSchema.safeParse({ version: 2, profiles: {} }).success).toBe(false)
  })
  it('rejeita profile sem command', () => {
    expect(profileEntrySchema.safeParse({ args: [] }).success).toBe(false)
  })
})

describe('ptyCreate origin/projectRoot refine', () => {
  const base = { id: 'a', command: 'bash', cwd: '/x', cols: 80, rows: 24 }
  it('origin user dispensa projectRoot', () => {
    expect(ptyCreate.safeParse({ ...base, origin: 'user' }).success).toBe(true)
  })
  it('origin project exige projectRoot', () => {
    expect(ptyCreate.safeParse({ ...base, origin: 'project' }).success).toBe(false)
    expect(ptyCreate.safeParse({ ...base, origin: 'project', projectRoot: '/x' }).success).toBe(true)
  })
  it('default origin = user', () => {
    const r = ptyCreate.safeParse(base)
    expect(r.success && r.data.origin).toBe('user')
  })
})

describe('configSet strips non-renderer keys (trust bypass guard)', () => {
  it('drops trust/currentProject/globalProfiles from patch', () => {
    const r = configSet.safeParse({ patch: { activeLayout: 'two', trust: { trustedFolders: ['C:\\'], deniedFolders: [] }, currentProject: '/x', globalProfiles: { a: { command: 'x' } } } })
    expect(r.success).toBe(true)
    if (r.success) {
      expect('trust' in r.data.patch).toBe(false)
      expect('currentProject' in r.data.patch).toBe(false)
      expect('globalProfiles' in r.data.patch).toBe(false)
      expect(r.data.patch.activeLayout).toBe('two')
    }
  })
})
