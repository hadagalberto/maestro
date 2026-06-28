import { describe, it, expect, vi, beforeEach } from 'vitest'

const files = new Map<string, string>()
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async (p: string) => { if (!files.has(p)) { const e: any = new Error('ENOENT'); e.code = 'ENOENT'; throw e } return files.get(p) }),
  writeFile: vi.fn(async (p: string, c: string) => { files.set(p, c) }),
}))
import { loadMaestroConfig, scaffoldMaestroConfig } from './maestroConfig'

beforeEach(() => files.clear())

describe('loadMaestroConfig', () => {
  it('ausente -> {ok:absent}', async () => {
    expect(await loadMaestroConfig('/no.yml')).toEqual({ ok: 'absent' })
  })
  it('válido -> profiles', async () => {
    files.set('/m.yml', 'version: 1\nprofiles:\n  claude:\n    command: claude\n')
    const r = await loadMaestroConfig('/m.yml')
    expect(r.ok).toBe(true)
    if (r.ok === true) expect(r.profiles.claude.command).toBe('claude')
  })
  it('erro de sintaxe -> problem syntax com linha', async () => {
    files.set('/m.yml', 'version: 1\nprofiles:\n  claude:\n   command: "unterminated\n')
    const r = await loadMaestroConfig('/m.yml')
    expect(r.ok).toBe(false)
    if (r.ok === false) expect(r.problems[0].kind).toBe('syntax')
  })
  it('erro de schema -> problem schema com path', async () => {
    files.set('/m.yml', 'version: 1\nprofiles:\n  claude:\n    args: []\n') // sem command
    const r = await loadMaestroConfig('/m.yml')
    expect(r.ok).toBe(false)
    if (r.ok === false) {
      const p = r.problems[0]
      expect(p.kind).toBe('schema')
      if (p.kind === 'schema') expect(p.path).toContain('claude')
    }
  })
  it('vazio -> problem', async () => {
    files.set('/m.yml', '\n')
    const r = await loadMaestroConfig('/m.yml')
    expect(r.ok).toBe(false)
  })
})

describe('scaffoldMaestroConfig', () => {
  it('escreve yaml parseável de volta', async () => {
    await scaffoldMaestroConfig('/m.yml')
    const r = await loadMaestroConfig('/m.yml')
    expect(r.ok).toBe(true)
  })
})
