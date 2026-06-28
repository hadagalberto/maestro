import { describe, it, expect } from 'vitest'
import { parsePorcelain, parseBranchLine, parseNumstat } from './parse'

describe('parseBranchLine', () => {
  it('com upstream + ahead/behind', () => {
    expect(parseBranchLine('## main...origin/main [ahead 2, behind 1]')).toEqual({ branch: 'main', ahead: 2, behind: 1 })
  })
  it('só ahead', () => {
    expect(parseBranchLine('## main...origin/main [ahead 3]')).toEqual({ branch: 'main', ahead: 3, behind: 0 })
  })
  it('sem upstream', () => {
    expect(parseBranchLine('## feature/x')).toEqual({ branch: 'feature/x', ahead: 0, behind: 0 })
  })
  it('sem commits ainda', () => {
    expect(parseBranchLine('## No commits yet on main')).toEqual({ branch: 'main', ahead: 0, behind: 0 })
  })
})

describe('parseNumstat', () => {
  it('números e binário', () => {
    expect(parseNumstat('12\t3\tsrc/a.ts\n-\t-\timg.png\n')).toEqual({ 'src/a.ts': { added: 12, deleted: 3 }, 'img.png': { added: 0, deleted: 0 } })
  })
  it('vazio', () => expect(parseNumstat('')).toEqual({}))
})

describe('parsePorcelain', () => {
  it('branch + modified staged/unstaged, added, deleted, untracked', () => {
    // -z: campos separados por NUL; primeiro é a linha de branch
    const z = ['## main...origin/main [ahead 1]', 'M  src/staged.ts', ' M src/unstaged.ts', 'A  src/new.ts', ' D src/gone.ts', '?? src/untracked.ts', ''].join('\0')
    const r = parsePorcelain(z)
    expect(r.branch).toEqual({ branch: 'main', ahead: 1, behind: 0 })
    const byPath = Object.fromEntries(r.files.map((f) => [f.path, f]))
    expect(byPath['src/staged.ts']).toMatchObject({ status: 'modified', staged: true, unstaged: false })
    expect(byPath['src/unstaged.ts']).toMatchObject({ status: 'modified', staged: false, unstaged: true })
    expect(byPath['src/new.ts']).toMatchObject({ status: 'added', staged: true })
    expect(byPath['src/gone.ts']).toMatchObject({ status: 'deleted', unstaged: true })
    expect(byPath['src/untracked.ts']).toMatchObject({ status: 'untracked', staged: false, unstaged: true })
  })
  it('rename consome o path original', () => {
    const z = ['## main', 'R  new.ts', 'old.ts', ''].join('\0')
    const r = parsePorcelain(z)
    expect(r.files).toHaveLength(1)
    expect(r.files[0]).toMatchObject({ path: 'new.ts', status: 'renamed', staged: true })
  })
})
