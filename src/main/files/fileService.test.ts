import { describe, it, expect, vi } from 'vitest'
import { FileService } from './fileService'

const cap = (impl: (args: string[]) => { stdout?: string; code?: number; stderr?: string }) =>
  vi.fn(async (o: { args?: string[] }) => { const r = impl(o.args ?? []); return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.code ?? 0, signal: null, durationMs: 1 } })
const svc = (c: ReturnType<typeof cap>) => new FileService(c as never, () => '/usr/bin/git')

describe('FileService', () => {
  it('listFiles usa ls-files -z e split por NUL', async () => {
    const c = cap((a) => { if (a.includes('rev-parse')) return { stdout: 'true' }; if (a.includes('ls-files')) return { stdout: 'a.ts\0b.ts\0' }; return {} })
    expect(await svc(c).listFiles('/r')).toEqual(['a.ts', 'b.ts'])
  })
  it('search monta flags (regex/case/word) e parseia', async () => {
    const c = cap((a) => { if (a.includes('rev-parse')) return { stdout: 'true' }; if (a[0] === 'grep') return { stdout: 'a.ts:1:hello\n' }; return {} })
    const r = await svc(c).search('/r', 'hello', { regex: true, caseSensitive: false, wholeWord: true })
    expect(r).toEqual([{ path: 'a.ts', matches: [{ line: 1, text: 'hello' }] }])
    const grepCall = c.mock.calls.find((x) => (x[0] as { args: string[] }).args[0] === 'grep')!
    const args = (grepCall[0] as { args: string[] }).args
    expect(args).toContain('-i'); expect(args).toContain('-w'); expect(args).toContain('-E'); expect(args.slice(-2)).toEqual(['-e', 'hello'])
  })
  it('search regex inválida (exit>1) -> throw', async () => {
    const c = cap((a) => { if (a.includes('rev-parse')) return { stdout: 'true' }; if (a[0] === 'grep') return { code: 2, stderr: 'bad regex' }; return {} })
    await expect(svc(c).search('/r', '(', { regex: true, caseSensitive: false, wholeWord: false })).rejects.toThrow(/bad regex/)
  })
  it('search sem match (exit 1) -> []', async () => {
    const c = cap((a) => { if (a.includes('rev-parse')) return { stdout: 'true' }; if (a[0] === 'grep') return { code: 1 }; return {} })
    expect(await svc(c).search('/r', 'zzz', { regex: false, caseSensitive: false, wholeWord: false })).toEqual([])
  })
})
