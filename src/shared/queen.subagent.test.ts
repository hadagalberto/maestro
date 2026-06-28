import { describe, it, expect } from 'vitest'
import { ptyCreate } from './schemas'

describe('ptyCreate name/parentId', () => {
  const base = { id: 'a', command: 'bash', cwd: '/x', cols: 80, rows: 24 }
  it('aceita name/parentId opcionais', () => {
    expect(ptyCreate.safeParse({ ...base, name: 'child', parentId: 'p1' }).success).toBe(true)
  })
  it('segue válido sem eles', () => {
    expect(ptyCreate.safeParse(base).success).toBe(true)
  })
})
