import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DEFAULT_CONFIG } from '@shared/types'

const { mockStore, data } = vi.hoisted(() => {
  const data: Record<string, unknown> = {}
  const mockStore = { get store() { return data }, get: (k: string) => data[k], set: vi.fn((k: string, v: unknown) => { data[k] = v }) }
  return { mockStore, data }
})
vi.mock('electron-store', () => ({ default: vi.fn(function () { return mockStore }) }))
import { ConfigStore } from './configStore'

beforeEach(() => { for (const k of Object.keys(data)) delete data[k]; mockStore.set.mockClear() })

describe('ConfigStore v2', () => {
  it('default quando vazio', () => { expect(new ConfigStore().get().schemaVersion).toBe(2) })
  it('migra v1 -> v2 adicionando campos novos', () => {
    data['config'] = { schemaVersion: 1, activeLayout: 'quad', panes: [], layoutSizes: {}, settings: DEFAULT_CONFIG.settings }
    const cs = new ConfigStore()
    expect(cs.get().schemaVersion).toBe(2)
    expect(cs.get().activeLayout).toBe('quad')
    expect(cs.get().globalProfiles).toEqual({})
    expect(cs.get().trust).toEqual({ trustedFolders: [], deniedFolders: [] })
  })
  it('pushRecentProject dedup + cap + define current', () => {
    const cs = new ConfigStore()
    for (let i = 0; i < 12; i++) cs.pushRecentProject('/p' + i)
    cs.pushRecentProject('/p0')
    expect(cs.get().recentProjects.length).toBeLessThanOrEqual(10)
    expect(cs.get().recentProjects[0]).toBe('/p0')
    expect(cs.get().currentProject).toBe('/p0')
  })
  it('grant/revoke trust', () => {
    const cs = new ConfigStore()
    cs.grantTrust('/a'); expect(cs.get().trust.trustedFolders).toContain('/a')
    cs.revokeTrust('/a'); expect(cs.get().trust.trustedFolders).not.toContain('/a')
  })
})
