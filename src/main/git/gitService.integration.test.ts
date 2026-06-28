import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import which from 'which'
import { GitService } from './gitService'

const git = which.sync('git', { nothrow: true })
const run = (cwd: string, ...a: string[]) => execFileSync(git!, a, { cwd })

describe.skipIf(!git)('GitService (real repo)', () => {
  let root: string
  const svc = new GitService()
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'maestro-git-'))
    run(root, 'init', '-q'); run(root, 'config', 'user.email', 't@t'); run(root, 'config', 'user.name', 'T')
    writeFileSync(join(root, 'a.txt'), 'hello\n')
  })
  it('lista untracked, stage+commit limpa, diff mostra mudança', async () => {
    let s = await svc.status(root)
    expect(s.isRepo).toBe(true)
    expect(s.unstaged.some((f) => f.path === 'a.txt' && f.status === 'untracked')).toBe(true)

    expect((await svc.stage(root, 'a.txt')).ok).toBe(true)
    expect((await svc.commit(root, 'init')).ok).toBe(true)
    s = await svc.status(root)
    expect(s.staged).toHaveLength(0); expect(s.unstaged).toHaveLength(0)

    writeFileSync(join(root, 'a.txt'), 'hello world\n')
    const diff = await svc.diff(root, 'a.txt', false)
    expect(diff).toContain('hello world')
    s = await svc.status(root)
    expect(s.unstaged.find((f) => f.path === 'a.txt')?.added).toBeGreaterThanOrEqual(1)
  })
})
