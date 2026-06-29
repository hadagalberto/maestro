import { describe, it, expect } from 'vitest'
import { projectPathFromArgs, userArgs } from './cliArgs'
import { resolve } from 'node:path'

describe('projectPathFromArgs', () => {
  const isDir = (p: string) => p === resolve('/cwd', '.') || p === resolve('/cwd', 'proj') || p === 'C:\\abs'
  it('sem args → null', () => {
    expect(projectPathFromArgs([], '/cwd', isDir)).toBeNull()
  })
  it('"." → cwd resolvido', () => {
    expect(projectPathFromArgs(['.'], '/cwd', isDir)).toBe(resolve('/cwd', '.'))
  })
  it('pasta relativa existente → resolvida', () => {
    expect(projectPathFromArgs(['proj'], '/cwd', isDir)).toBe(resolve('/cwd', 'proj'))
  })
  it('ignora flags e pega a primeira pasta', () => {
    expect(projectPathFromArgs(['--foo', 'C:\\abs'], '/cwd', () => true)).toBe(resolve('/cwd', 'C:\\abs'))
  })
  it('arg que não é pasta → null', () => {
    expect(projectPathFromArgs(['nope'], '/cwd', () => false)).toBeNull()
  })
})

describe('userArgs', () => {
  it('empacotado corta argv[0] (exe)', () => {
    expect(userArgs(['C:\\app\\Maestro.exe', 'C:\\proj'], true)).toEqual(['C:\\proj'])
  })
  it('dev corta argv[0] (electron) e argv[1] (appDir)', () => {
    expect(userArgs(['electron', '.', 'C:\\proj'], false)).toEqual(['C:\\proj'])
  })
})
