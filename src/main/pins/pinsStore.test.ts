import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockStore, data } = vi.hoisted(() => {
  const data: Record<string, unknown> = {}
  const mockStore = { get: (k: string) => data[k], set: vi.fn((k: string, v: unknown) => { data[k] = v }) }
  return { mockStore, data }
})
vi.mock('electron-store', () => ({ default: vi.fn(function () { return mockStore }) }))
import { PinsStore } from './pinsStore'

beforeEach(() => { for (const k of Object.keys(data)) delete data[k]; mockStore.set.mockClear() })

describe('PinsStore', () => {
  it('createPin + listPins por projeto', () => {
    const s = new PinsStore()
    const p = s.createPin('/a', 'fazer X')
    expect(p.text).toBe('fazer X'); expect(p.done).toBe(false)
    expect(s.listPins('/a')).toHaveLength(1)
    expect(s.listPins('/b')).toHaveLength(0) // outro projeto isolado
  })
  it('setPinDone / updatePin / deletePin', () => {
    const s = new PinsStore()
    const p = s.createPin('/a', 'x')
    s.setPinDone('/a', p.id, true); expect(s.listPins('/a')[0].done).toBe(true)
    s.updatePin('/a', p.id, 'y'); expect(s.listPins('/a')[0].text).toBe('y')
    s.deletePin('/a', p.id); expect(s.listPins('/a')).toHaveLength(0)
  })
  it('notes get/set/append', () => {
    const s = new PinsStore()
    expect(s.getNotes('/a')).toBe('')
    s.setNotes('/a', 'linha1'); expect(s.getNotes('/a')).toBe('linha1')
    s.appendNotes('/a', 'linha2'); expect(s.getNotes('/a')).toBe('linha1\nlinha2')
    s.appendNotes('/b', 'só'); expect(s.getNotes('/b')).toBe('só')
  })
})
