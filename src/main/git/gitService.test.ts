import { describe, it, expect, vi } from 'vitest'
import { GitService } from './gitService'

const cap = (impl: (args: string[]) => { stdout?: string; stderr?: string; code?: number }) =>
  vi.fn(async (o: { args?: string[] }) => { const r = impl(o.args ?? []); return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.code ?? 0, signal: null, durationMs: 1 } })

const svc = (capFn: ReturnType<typeof cap>) => new GitService(capFn as never, () => '/usr/bin/git')

describe('GitService', () => {
  it('status combina porcelain + numstat', async () => {
    const c = cap((args) => {
      if (args.includes('rev-parse')) return { stdout: 'true' }
      if (args.includes('--porcelain=v1')) return { stdout: ['## main...origin/main [ahead 1]', 'M  a.ts', ' M b.ts', ''].join('\0') }
      if (args.includes('--cached') && args.includes('--numstat')) return { stdout: '5\t2\ta.ts\n' }
      if (args.includes('--numstat')) return { stdout: '1\t1\tb.ts\n' }
      if (args[0] === 'remote') return { stdout: 'origin\n' }
      return {}
    })
    const s = await svc(c).status('/r')
    expect(s.branch).toBe('main'); expect(s.ahead).toBe(1); expect(s.hasRemote).toBe(true)
    expect(s.staged).toEqual([{ path: 'a.ts', status: 'modified', staged: true, added: 5, deleted: 2 }])
    expect(s.unstaged).toEqual([{ path: 'b.ts', status: 'modified', staged: false, added: 1, deleted: 1 }])
  })
  it('não-repo -> isRepo false', async () => {
    const c = cap(() => ({ code: 128, stderr: 'not a git repo' }))
    expect((await svc(c).status('/r')).isRepo).toBe(false)
  })
  it('commit monta args e mapeia exit', async () => {
    const c = cap((args) => (args[0] === 'commit' ? { code: 0 } : {}))
    expect(await svc(c).commit('/r', 'msg')).toEqual({ ok: true })
    expect(c).toHaveBeenCalledWith(expect.objectContaining({ args: ['commit', '-m', 'msg'] }))
  })
  it('commit falho -> ok:false com stderr', async () => {
    const c = cap(() => ({ code: 1, stderr: 'nothing to commit' }))
    expect(await svc(c).commit('/r', 'm')).toEqual({ ok: false, message: 'nothing to commit' })
  })
  it('git ausente -> erro claro', async () => {
    const s = new GitService(cap(() => ({})) as never, () => null)
    await expect(s.commit('/r', 'm')).rejects.toThrow(/git/)
  })
})
