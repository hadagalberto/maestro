import which from 'which'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { captureOnce, type CaptureResult } from '../discussion/captureOnce'
import { parseGrep } from './parseGrep'
import type { SearchFileResult, SearchOptions, FileContent } from '@shared/files'

type Capture = (o: { command: string; args?: string[]; cwd: string; timeoutMs?: number }) => Promise<CaptureResult>
const SKIP = new Set(['node_modules', '.git', 'dist', 'out', 'release', '.planning'])
const MAX_FILES = 20_000
const MAX_BYTES = 512 * 1024

export class FileService {
  private gitPath: string | null | undefined
  constructor(private cap: Capture = captureOnce, private resolve: (c: string) => string | null = (c) => (which.sync(c, { nothrow: true }) as string | null)) {}
  private git(): string | null { if (this.gitPath === undefined) this.gitPath = this.resolve('git'); return this.gitPath }

  private async isRepo(root: string): Promise<boolean> {
    const g = this.git(); if (!g) return false
    try { const r = await this.cap({ command: g, args: ['rev-parse', '--is-inside-work-tree'], cwd: root }); return r.code === 0 && r.stdout.trim() === 'true' } catch { return false }
  }

  async listFiles(root: string): Promise<string[]> {
    if (await this.isRepo(root)) {
      const r = await this.cap({ command: this.git()!, args: ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd: root })
      return r.stdout.split('\0').filter(Boolean).slice(0, MAX_FILES)
    }
    return this.walk(root)
  }

  private async walk(root: string): Promise<string[]> {
    const out: string[] = []
    const rec = async (dir: string) => {
      if (out.length >= MAX_FILES) return
      let entries: import('node:fs').Dirent[]
      try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        if (out.length >= MAX_FILES) return
        if (e.name.startsWith('.git')) continue
        const full = join(dir, e.name)
        if (e.isDirectory()) { if (!SKIP.has(e.name)) await rec(full) }
        else if (e.isFile()) out.push(relative(root, full).split(sep).join('/'))
      }
    }
    await rec(root)
    return out
  }

  async search(root: string, query: string, opts: SearchOptions): Promise<SearchFileResult[]> {
    if (!query) return []
    if (await this.isRepo(root)) {
      const args = ['grep', '-n', '-I', '--untracked']
      if (!opts.caseSensitive) args.push('-i')
      if (opts.wholeWord) args.push('-w')
      args.push(opts.regex ? '-E' : '-F', '-e', query)
      const r = await this.cap({ command: this.git()!, args, cwd: root })
      // git grep exit: 0 = matches, 1 = no matches, >1 = error (e.g. bad regex)
      if ((r.code ?? 0) > 1) throw new Error((r.stderr || 'busca falhou').trim())
      return parseGrep(r.stdout).slice(0, 50)
    }
    return this.walkSearch(root, query, opts)
  }

  private async walkSearch(root: string, query: string, opts: SearchOptions): Promise<SearchFileResult[]> {
    const re = this.toRegExp(query, opts)
    const files = await this.walk(root)
    const results: SearchFileResult[] = []
    for (const f of files) {
      if (results.length >= 50) break
      let content: string
      try { content = await readFile(join(root, f), 'utf8') } catch { continue }
      if (content.includes('\0')) continue
      const matches = content.split('\n').map((text, i) => ({ line: i + 1, text })).filter((m) => re.test(m.text)).slice(0, 200)
      if (matches.length) results.push({ path: f, matches })
    }
    return results
  }
  private toRegExp(query: string, opts: SearchOptions): RegExp {
    let src = opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (opts.wholeWord) src = `\\b${src}\\b`
    try { return new RegExp(src, opts.caseSensitive ? 'g' : 'gi') } catch { return /$^/ }
  }

  async read(root: string, relPath: string): Promise<FileContent> {
    const base = resolve(root)
    const full = resolve(base, relPath)
    if (full !== base && !full.startsWith(base + sep)) {
      return { path: relPath, content: 'caminho fora do projeto', truncated: false, binary: false }
    }
    let buf: Buffer
    try { buf = await readFile(full) } catch (e) { return { path: relPath, content: `erro: ${(e as Error).message}`, truncated: false, binary: false } }
    const head = buf.subarray(0, 8192)
    if (head.includes(0)) return { path: relPath, content: '', truncated: false, binary: true }
    const truncated = buf.length > MAX_BYTES
    return { path: relPath, content: buf.subarray(0, MAX_BYTES).toString('utf8'), truncated, binary: false }
  }
}
