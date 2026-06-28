import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./maestroConfig', () => ({ loadMaestroConfig: vi.fn() }))
vi.mock('./maestroWatcher', () => ({ MaestroWatcher: class { start = vi.fn(); stop = vi.fn() } }))
import { loadMaestroConfig } from './maestroConfig'
import { ProjectManager } from './projectManager'
import { PROFILE_PRESETS } from '@shared/presets'

function fakeConfig(over: Record<string, unknown> = {}) {
  const state = { globalProfiles: {}, currentProject: null as string | null, recentProjects: [] as string[], trust: { trustedFolders: [] as string[], deniedFolders: [] as string[] }, ...over }
  return {
    get: () => state,
    pushRecentProject: vi.fn((p: string) => { state.currentProject = p; state.recentProjects = [p] }),
  } as any
}

beforeEach(() => (loadMaestroConfig as any).mockReset())

describe('ProjectManager.computeState', () => {
  it('sem projeto -> só presets, sem problems', async () => {
    const pm = new ProjectManager(fakeConfig(), () => {})
    const st = await pm.state()
    expect(st.currentProject).toBeNull()
    expect(st.profiles.some((p) => p.id === 'claude')).toBe(true)
    expect(st.problems).toEqual([])
  })
  it('projeto com maestro.yml válido + trusted', async () => {
    ;(loadMaestroConfig as any).mockResolvedValue({ ok: true, profiles: { api: { command: 'npm', args: ['run','dev'], autoStart: true } } })
    const cfg = fakeConfig({ currentProject: '/proj', trust: { trustedFolders: ['/proj'], deniedFolders: [] } })
    const pm = new ProjectManager(cfg, () => {})
    const st = await pm.state()
    expect(st.trusted).toBe(true)
    expect(st.profiles.find((p) => p.id === 'api')!.source).toBe('project')
    expect(st.hasMaestroFile).toBe(true)
  })
  it('maestro.yml inválido -> problems preenchido', async () => {
    ;(loadMaestroConfig as any).mockResolvedValue({ ok: false, problems: [{ kind: 'schema', path: 'profiles.x', message: 'bad' }] })
    const pm = new ProjectManager(fakeConfig({ currentProject: '/p' }), () => {})
    const st = await pm.state()
    expect(st.problems.length).toBe(1)
  })
})
