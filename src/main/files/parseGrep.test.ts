import { describe, it, expect } from 'vitest'
import { parseGrep } from './parseGrep'

describe('parseGrep', () => {
  it('agrupa por arquivo, multi-match, line+text', () => {
    const out = 'src/a.ts:3:const x = 1\nsrc/a.ts:9:return x\nsrc/b.ts:1:hello\n'
    expect(parseGrep(out)).toEqual([
      { path: 'src/a.ts', matches: [{ line: 3, text: 'const x = 1' }, { line: 9, text: 'return x' }] },
      { path: 'src/b.ts', matches: [{ line: 1, text: 'hello' }] },
    ])
  })
  it('texto com dois-pontos preserva o resto', () => {
    expect(parseGrep('a.ts:2:http://x:8080')).toEqual([{ path: 'a.ts', matches: [{ line: 2, text: 'http://x:8080' }] }])
  })
  it('vazio -> []', () => expect(parseGrep('')).toEqual([]))
  it('cap de matches por arquivo', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `a.ts:${i + 1}:m`).join('\n')
    const r = parseGrep(lines, 3)
    expect(r[0].matches).toHaveLength(3)
  })
})
