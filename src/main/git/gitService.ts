import which from 'which'
import { captureOnce, type CaptureResult } from '../discussion/captureOnce'
import { parsePorcelain, parseNumstat } from './parse'
import type { GitStatus, GitFile, GitResult, PrResult } from '@shared/git'

type Capture = (o: { command: string; args?: string[]; cwd: string; stdin?: string; timeoutMs?: number }) => Promise<CaptureResult>

export class GitService {
  private gitPath: string | null = null
  private ghPath: string | null = null
  constructor(private cap: Capture = captureOnce, private resolve: (cmd: string) => string | null = (c) => (which.sync(c, { nothrow: true }) as string | null)) {}

  private bin(which: 'git' | 'gh'): string {
    if (which === 'git') { this.gitPath ??= this.resolve('git'); if (!this.gitPath) throw new Error('git não encontrado no PATH'); return this.gitPath }
    this.ghPath ??= this.resolve('gh'); if (!this.ghPath) throw new Error('gh não encontrado no PATH'); return this.ghPath
  }

  private async run(binName: 'git' | 'gh', args: string[], cwd: string, stdin?: string): Promise<CaptureResult> {
    return this.cap({ command: this.bin(binName), args, cwd, stdin, timeoutMs: 30_000 })
  }
  private result(r: CaptureResult): GitResult { return r.code === 0 ? { ok: true } : { ok: false, message: (r.stderr || r.stdout).trim() } }

  async isRepo(root: string): Promise<boolean> {
    try { const r = await this.run('git', ['rev-parse', '--is-inside-work-tree'], root); return r.code === 0 && r.stdout.trim() === 'true' } catch { return false }
  }

  async status(root: string): Promise<GitStatus> {
    if (!(await this.isRepo(root))) return { isRepo: false, branch: null, ahead: 0, behind: 0, staged: [], unstaged: [], hasRemote: false }
    const [porc, nsU, nsS, remotes] = await Promise.all([
      this.run('git', ['status', '--porcelain=v1', '-b', '-z'], root),
      this.run('git', ['diff', '--numstat'], root),
      this.run('git', ['diff', '--cached', '--numstat'], root),
      this.run('git', ['remote'], root),
    ])
    const { branch, files } = parsePorcelain(porc.stdout)
    const numU = parseNumstat(nsU.stdout); const numS = parseNumstat(nsS.stdout)
    const mk = (e: typeof files[number], staged: boolean): GitFile => ({ path: e.path, status: e.status, staged, added: (staged ? numS : numU)[e.path]?.added ?? 0, deleted: (staged ? numS : numU)[e.path]?.deleted ?? 0 })
    return {
      isRepo: true, branch: branch.branch, ahead: branch.ahead, behind: branch.behind,
      staged: files.filter((f) => f.staged).map((f) => mk(f, true)),
      unstaged: files.filter((f) => f.unstaged).map((f) => mk(f, false)),
      hasRemote: remotes.stdout.trim().length > 0,
    }
  }

  async diff(root: string, file: string, staged: boolean): Promise<string> {
    const args = staged ? ['diff', '--cached', '--', file] : ['diff', '--', file]
    return (await this.run('git', args, root)).stdout
  }
  async stage(root: string, file: string): Promise<GitResult> { return this.result(await this.run('git', ['add', '--', file], root)) }
  async unstage(root: string, file: string): Promise<GitResult> { return this.result(await this.run('git', ['restore', '--staged', '--', file], root)) }
  async commit(root: string, message: string): Promise<GitResult> { return this.result(await this.run('git', ['commit', '-m', message], root)) }
  async push(root: string): Promise<GitResult> { return this.result(await this.run('git', ['push'], root)) }

  async createPR(root: string, title: string, body: string): Promise<PrResult> {
    try {
      const r = await this.run('gh', ['pr', 'create', '--title', title, '--body', body], root)
      if (r.code === 0) return { ok: true, url: r.stdout.trim().split('\n').pop() }
      return { ok: false, message: (r.stderr || r.stdout).trim() }
    } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) } }
  }

  async suggestCommit(root: string, aiCommand: string, aiArgs: string[]): Promise<string> {
    const diff = await this.run('git', ['diff', '--cached'], root)
    const text = diff.stdout.trim()
    if (!text) return ''
    const capped = text.split('\n').slice(0, 12_000).join('\n')
    const prompt = `Write a concise Conventional Commits message (subject line, optionally a short body) for this staged diff. Output ONLY the message.\n\n${capped}`
    const args = aiArgs.map((a) => (a === '{{prompt}}' ? prompt : a))
    const r = await this.cap({ command: aiCommand, args, cwd: root, timeoutMs: 120_000 })
    return r.stdout.trim()
  }
}
