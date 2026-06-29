import { describe, it, expect } from 'vitest'
import { fuzzyScore, fuzzyFilter } from './fuzzy'

describe('fuzzyScore', () => {
  it('casa subsequência e dá posições', () => {
    const r = fuzzyScore('app', 'src/app.ts')
    expect(r).not.toBeNull()
    expect(r!.positions.length).toBe(3)
  })
  it('não-match -> null', () => expect(fuzzyScore('xyz', 'src/app.ts')).toBeNull())
  it('basename pontua mais que path', () => {
    const inName = fuzzyScore('app', 'app.ts')!.score
    const inPath = fuzzyScore('app', 'app/z.ts')!.score
    expect(inName).toBeGreaterThan(inPath)
  })
  it('consecutivo pontua mais que espalhado', () => {
    const consec = fuzzyScore('app', 'app.ts')!.score
    const spread = fuzzyScore('app', 'a_p_p.ts')!.score
    expect(consec).toBeGreaterThan(spread)
  })
})

describe('fuzzyFilter', () => {
  it('ordena por score desc e filtra não-match', () => {
    const r = fuzzyFilter('app', ['z.ts', 'src/app.ts', 'app.ts'])
    expect(r.map((x) => x.path)).toEqual(['app.ts', 'src/app.ts'])
  })
})
