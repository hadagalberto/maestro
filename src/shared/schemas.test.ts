import { describe, it, expect } from 'vitest'
import { ptyCreate, shellOpen } from './schemas'

describe('schemas', () => {
  it('aceita payload pty:create válido', () => {
    expect(ptyCreate.safeParse({ id: 'a', command: 'bash', cwd: '/tmp', cols: 80, rows: 24 }).success).toBe(true)
  })
  it('rejeita cols não positivo', () => {
    expect(ptyCreate.safeParse({ id: 'a', command: 'bash', cwd: '/tmp', cols: 0, rows: 24 }).success).toBe(false)
  })
  it('rejeita url inválida em shell:openExternal', () => {
    expect(shellOpen.safeParse({ url: 'not a url' }).success).toBe(false)
  })
})
