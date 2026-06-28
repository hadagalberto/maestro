import { describe, it, expect } from 'vitest'
import { mergeProfiles } from './profileMerge'

const presets = { shell: { command: 'bash', color: '#111' }, claude: { command: 'claude' } }

describe('mergeProfiles', () => {
  it('inclui presets quando não há global/projeto', () => {
    const out = mergeProfiles(presets, {}, {})
    const ids = out.map((p) => p.id).sort()
    expect(ids).toContain('claude'); expect(ids).toContain('shell')
    expect(out.find((p) => p.id === 'claude')!.source).toBe('preset')
  })
  it('global sobrescreve preset; projeto sobrescreve global', () => {
    const out = mergeProfiles(presets, { claude: { command: 'claude-global' } }, { claude: { command: 'claude-proj' } })
    const c = out.find((p) => p.id === 'claude')!
    expect(c.command).toBe('claude-proj'); expect(c.source).toBe('project')
  })
  it('disabled remove o perfil do resultado', () => {
    const out = mergeProfiles(presets, {}, { shell: { command: 'bash', disabled: true } })
    expect(out.find((p) => p.id === 'shell')).toBeUndefined()
  })
  it('name default = id e args default = []', () => {
    const out = mergeProfiles({ x: { command: 'x' } }, {}, {})
    const x = out.find((p) => p.id === 'x')!
    expect(x.name).toBe('x'); expect(x.args).toEqual([])
  })
})
