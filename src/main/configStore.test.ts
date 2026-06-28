import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DEFAULT_CONFIG } from '@shared/types'

const { mockStore, data } = vi.hoisted(() => {
  const data: Record<string, unknown> = {}
  const mockStore = {
    get store() { return data },
    get: (k: string) => data[k],
    set: vi.fn((k: string, v: unknown) => { data[k] = v }),
  }
  return { mockStore, data }
})
vi.mock('electron-store', () => ({ default: vi.fn(function () { return mockStore }) }))

import { ConfigStore } from './configStore'

beforeEach(() => { for (const k of Object.keys(data)) delete data[k]; mockStore.set.mockClear() })

describe('ConfigStore', () => {
  it('retorna default quando vazio', () => {
    const cs = new ConfigStore()
    expect(cs.get().activeLayout).toBe(DEFAULT_CONFIG.activeLayout)
  })
  it('faz merge de patch parcial', () => {
    const cs = new ConfigStore()
    cs.set({ activeLayout: 'quad' })
    expect(cs.get().activeLayout).toBe('quad')
    expect(cs.get().settings.scrollback).toBe(DEFAULT_CONFIG.settings.scrollback)
  })
  it('persiste panes', () => {
    const cs = new ConfigStore()
    cs.set({ panes: [{ id: 'a', name: 'A', command: 'bash', cwd: '/tmp' }] })
    expect(cs.get().panes).toHaveLength(1)
  })
})
