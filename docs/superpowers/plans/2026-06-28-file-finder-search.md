# File Finder + Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A VSCode-style fuzzy file finder, find-in-files (regex/case/word), and a read-only file viewer with Shiki syntax highlight — all respecting .gitignore.

**Architecture:** Main `FileService` lists/searches/reads via git (ls-files/grep) through `captureOnce` (#3) with a fallback walk for non-git; pure parsers + a pure renderer fuzzy scorer; Shiki lives ONLY in the Vite-bundled renderer (ESM-only) using the JS engine (no WASM) with lazy per-language loading. IPC `git`-style `files:*` channels operate on the current project root.

**Tech Stack:** shiki ^4.3.0 (+ @shikijs/* — renderer only), captureOnce + which (main), zod 4, React 19 + zustand, vitest + Playwright.

**Spec:** `docs/superpowers/specs/2026-06-28-file-finder-search-design.md`

---

## File Structure

```
+ src/shared/files.ts            SearchMatch/SearchFileResult/SearchOptions/FileContent
+ src/main/files/parseGrep.ts    parseGrep
+ src/main/files/fileService.ts  FileService
~ src/shared/ipc.ts              files:* channels
~ src/shared/schemas.ts          files:search/read schemas
~ src/main/ipcRouter.ts          files:* handlers
~ src/main/index.ts              construct FileService
~ package.json                   shiki + @shikijs/*
+ src/renderer/files/fuzzy.ts    fuzzyScore/fuzzyFilter
+ src/renderer/files/highlighter.ts  Shiki singleton + extToLang
+ src/renderer/store/filesStore.ts
+ src/renderer/ui/FileFinder.tsx
+ src/renderer/ui/SearchPanel.tsx
+ src/renderer/ui/FileViewer.tsx
~ src/renderer/App.tsx           buttons + keybindings + panels
+ e2e/files.spec.ts
```

---

## Task 1: shared files types + schemas + ipc + Shiki deps

**Files:** `src/shared/files.ts`, `src/shared/schemas.ts`, `src/shared/ipc.ts`, `package.json`

- [ ] **Step 1: Install Shiki (renderer-only deps)**

Run: `npm install shiki@^4.3.0 @shikijs/langs@^4.3.0 @shikijs/themes@^4.3.0`
Expected: installs 4.3.x. (ESM-only — used ONLY under src/renderer; renderer is Vite-bundled so no externalize change.)

- [ ] **Step 2: Create `src/shared/files.ts`**

```ts
export interface SearchMatch { line: number; text: string }
export interface SearchFileResult { path: string; matches: SearchMatch[] }
export interface SearchOptions { regex: boolean; caseSensitive: boolean; wholeWord: boolean }
export interface FileContent { path: string; content: string; truncated: boolean; binary: boolean }
```

- [ ] **Step 3: Extend `src/shared/schemas.ts`**

Append:
```ts
export const filesSearchArgs = z.object({ query: z.string(), opts: z.object({ regex: z.boolean(), caseSensitive: z.boolean(), wholeWord: z.boolean() }) })
export const filesReadArgs = z.object({ path: z.string().min(1) })
```
Add to `schemaByChannel`:
```ts
  'files:search': filesSearchArgs,
  'files:read': filesReadArgs,
```
(`files:list` — no args, pass-through.)

- [ ] **Step 4: Extend `src/shared/ipc.ts`**

Add `import type { SearchFileResult, SearchOptions, FileContent } from './files'`. Append to `IpcRequest`:
```ts
  'files:list': { args: undefined; result: string[] }
  'files:search': { args: { query: string; opts: SearchOptions }; result: SearchFileResult[] }
  'files:read': { args: { path: string }; result: FileContent }
```
Re-export: `export type { SearchFileResult, SearchMatch, SearchOptions, FileContent } from './files'`.

- [ ] **Step 5: Typecheck + unit**

Run: `npm run typecheck && npm run test:unit` → typecheck 0; unit green (122).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/shared/files.ts src/shared/schemas.ts src/shared/ipc.ts
git commit -m "feat: shared files types/schemas/ipc + shiki deps"
```

---

## Task 2: parseGrep

**Files:** `src/main/files/parseGrep.ts`; Test `src/main/files/parseGrep.test.ts`

- [ ] **Step 1: Write failing test `src/main/files/parseGrep.test.ts`**

```ts
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
```

- [ ] **Step 2: Run to see fail** — `npx vitest run src/main/files/parseGrep.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/main/files/parseGrep.ts`**

```ts
import type { SearchFileResult } from '@shared/files'

// Parses `git grep -n` output (no -z): each line `path:line:text` (text may contain ':').
export function parseGrep(out: string, maxPerFile = 200): SearchFileResult[] {
  const byPath = new Map<string, SearchFileResult>()
  for (const raw of out.split('\n')) {
    if (!raw) continue
    const m = /^(.*?):(\d+):(.*)$/.exec(raw)
    if (!m) continue
    const path = m[1]; const line = Number(m[2]); const text = m[3]
    let entry = byPath.get(path)
    if (!entry) { entry = { path, matches: [] }; byPath.set(path, entry) }
    if (entry.matches.length < maxPerFile) entry.matches.push({ line, text })
  }
  return [...byPath.values()]
}
```

- [ ] **Step 4: Run to see pass** — `npx vitest run src/main/files/parseGrep.test.ts` → 4 PASS. `npm run typecheck` → 0.

- [ ] **Step 5: Commit**

```bash
git add src/main/files/parseGrep.ts src/main/files/parseGrep.test.ts
git commit -m "feat: parseGrep (git grep -n output -> grouped results)"
```

---

## Task 3: FileService (+ unit + real-repo integration)

**Files:** `src/main/files/fileService.ts`; Tests `src/main/files/fileService.test.ts`, `src/main/files/fileService.integration.test.ts`

- [ ] **Step 1: Implement `src/main/files/fileService.ts`**

```ts
import which from 'which'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
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
      if (r.code > 1) throw new Error((r.stderr || 'busca falhou').trim())
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
    const full = join(root, relPath)
    let buf: Buffer
    try { buf = await readFile(full) } catch (e) { return { path: relPath, content: `erro: ${(e as Error).message}`, truncated: false, binary: false } }
    const head = buf.subarray(0, 8192)
    if (head.includes(0)) return { path: relPath, content: '', truncated: false, binary: true }
    const truncated = buf.length > MAX_BYTES
    return { path: relPath, content: buf.subarray(0, MAX_BYTES).toString('utf8'), truncated, binary: false }
  }
}
```

- [ ] **Step 2: Write `src/main/files/fileService.test.ts`** (captureOnce + which mocked)

```ts
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
```

- [ ] **Step 3: Write `src/main/files/fileService.integration.test.ts`** (real temp git repo)

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import which from 'which'
import { FileService } from './fileService'

const git = which.sync('git', { nothrow: true })
const run = (cwd: string, ...a: string[]) => execFileSync(git!, a, { cwd })

describe.skipIf(!git)('FileService (real repo)', () => {
  let root: string
  const svc = new FileService()
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'maestro-files-'))
    run(root, 'init', '-q'); run(root, 'config', 'user.email', 't@t'); run(root, 'config', 'user.name', 'T')
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src', 'app.ts'), 'const greet = "hello"\n')
    writeFileSync(join(root, 'keep.md'), '# hello world\n')
    writeFileSync(join(root, 'ignored.txt'), 'hello secret\n')
    writeFileSync(join(root, '.gitignore'), 'ignored.txt\n')
  })
  it('listFiles respeita .gitignore', async () => {
    const files = await svc.listFiles(root)
    expect(files).toContain('src/app.ts'); expect(files).toContain('keep.md'); expect(files).toContain('.gitignore')
    expect(files).not.toContain('ignored.txt')
  })
  it('search acha em arquivos versionados e ignora o .gitignore-ado', async () => {
    const r = await svc.search(root, 'hello', { regex: false, caseSensitive: false, wholeWord: false })
    const paths = r.map((x) => x.path)
    expect(paths).toContain('src/app.ts'); expect(paths).toContain('keep.md')
    expect(paths).not.toContain('ignored.txt')
  })
  it('read devolve conteúdo', async () => {
    const c = await svc.read(root, 'src/app.ts')
    expect(c.content).toContain('greet'); expect(c.binary).toBe(false)
  })
})
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/main/files/fileService.test.ts src/main/files/fileService.integration.test.ts && npm run typecheck`
Expected: unit (4) + integration (3, real git) pass; typecheck 0. NOTE: if the real `git grep` excludes untracked-but-not-ignored differently or the search test sees `ignored.txt` (because `--untracked` includes untracked files that AREN'T ignored — `ignored.txt` IS ignored so it's excluded; good), confirm the assertion holds; adapt the integration assertions to real git behavior if needed (keep the meaning: ignored file excluded).

- [ ] **Step 5: Commit**

```bash
git add src/main/files/fileService.ts src/main/files/fileService.test.ts src/main/files/fileService.integration.test.ts
git commit -m "feat: FileService (list/search/read, git + fallback walk) + real-repo integration"
```

---

## Task 4: IPC handlers + main wiring

**Files:** `src/main/ipcRouter.ts`, `src/main/index.ts`

- [ ] **Step 1: Extend `src/main/ipcRouter.ts`**

Add to `RouterDeps`: `files: FileService` (top `import type { FileService } from './files/fileService'`). (Reuse the existing `currentProjectRoot` getter added in #6.) Handlers:
```ts
  handle('files:list', async () => { const r = deps.currentProjectRoot(); return r ? deps.files.listFiles(r) : [] })
  handle('files:search', async (a) => { const r = deps.currentProjectRoot(); if (!r) return []; try { return await deps.files.search(r, a.query, a.opts) } catch { return [] } })
  handle('files:read', async (a) => { const r = deps.currentProjectRoot(); return r ? deps.files.read(r, a.path) : { path: a.path, content: '', truncated: false, binary: false } })
```

- [ ] **Step 2: Extend `src/main/index.ts`**

Add `import { FileService } from './files/fileService'`; `const files = new FileService()`; add `files` to the `registerIpc({...})` deps.

- [ ] **Step 3: Typecheck + unit + build**

Run: `npm run typecheck && npm run test:unit && npm run build` → all green/clean.

- [ ] **Step 4: Commit**

```bash
git add src/main/ipcRouter.ts src/main/index.ts
git commit -m "feat: files IPC handlers + FileService wiring"
```

---

## Task 5: Renderer utils — fuzzy + Shiki highlighter

**Files:** `src/renderer/files/fuzzy.ts` (+test); `src/renderer/files/highlighter.ts`

- [ ] **Step 1: Write failing test `src/renderer/files/fuzzy.test.ts`**

```ts
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
```

- [ ] **Step 2: Run to see fail** — `npx vitest run src/renderer/files/fuzzy.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/renderer/files/fuzzy.ts`**

```ts
export interface FuzzyResult { path: string; score: number; positions: number[] }

const isBoundary = (s: string, i: number): boolean => {
  if (i === 0) return true
  const p = s[i - 1]
  return p === '/' || p === '_' || p === '-' || p === '.' || (p === p.toLowerCase() && s[i] === s[i].toUpperCase())
}

export function fuzzyScore(query: string, target: string): { score: number; positions: number[] } | null {
  if (!query) return { score: 0, positions: [] }
  const q = query.toLowerCase(); const t = target.toLowerCase()
  const baseStart = target.lastIndexOf('/') + 1
  const positions: number[] = []
  let qi = 0; let score = 0; let prev = -2
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      positions.push(i)
      let pt = 1
      if (i === prev + 1) pt += 5            // consecutive
      if (isBoundary(target, i)) pt += 8      // word/segment boundary
      if (i >= baseStart) pt += 6             // in basename
      score += pt; prev = i; qi++
    }
  }
  if (qi < q.length) return null
  score -= (target.length - q.length) * 0.1   // slight preference for shorter targets
  return { score, positions }
}

export function fuzzyFilter(query: string, paths: string[], limit = 200): FuzzyResult[] {
  const out: FuzzyResult[] = []
  for (const path of paths) { const r = fuzzyScore(query, path); if (r) out.push({ path, ...r }) }
  out.sort((a, b) => b.score - a.score)
  return out.slice(0, limit)
}
```

- [ ] **Step 4: Run to see pass** — `npx vitest run src/renderer/files/fuzzy.test.ts` → PASS (5). `npm run typecheck` → 0.

- [ ] **Step 5: Create `src/renderer/files/highlighter.ts`** (Shiki, renderer-only)

```ts
import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

const THEME = 'github-dark'
const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
  json: 'json', md: 'markdown', markdown: 'markdown', css: 'css', scss: 'scss', html: 'html', xml: 'xml',
  py: 'python', rb: 'ruby', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cs: 'csharp',
  php: 'php', sh: 'bash', bash: 'bash', zsh: 'bash', yaml: 'yaml', yml: 'yaml', toml: 'toml', sql: 'sql',
  swift: 'swift', lua: 'lua', dockerfile: 'docker', vue: 'vue', svelte: 'svelte', dart: 'dart', scala: 'scala', ex: 'elixir', exs: 'elixir', clj: 'clojure',
}

export function extToLang(pathOrExt: string): string {
  const name = pathOrExt.split('/').pop() ?? pathOrExt
  if (name.toLowerCase() === 'dockerfile') return 'docker'
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
  return EXT_TO_LANG[ext] ?? 'text'
}

let hlPromise: Promise<HighlighterCore> | null = null
const loaded = new Set<string>(['text'])
function getHighlighter(): Promise<HighlighterCore> {
  hlPromise ??= createHighlighterCore({
    engine: createJavaScriptRegexEngine(),
    themes: [import('@shikijs/themes/github-dark')],
    langs: [],
  })
  return hlPromise
}

export async function highlight(code: string, pathOrExt: string): Promise<string> {
  const lang = extToLang(pathOrExt)
  const hl = await getHighlighter()
  if (lang !== 'text' && !loaded.has(lang)) {
    try { await hl.loadLanguage(import(`@shikijs/langs/${lang}`)); loaded.add(lang) } catch { /* unknown -> text */ }
  }
  const useLang = loaded.has(lang) ? lang : 'text'
  return hl.codeToHtml(code, { lang: useLang, theme: THEME })
}
```
NOTE: dynamic `import(\`@shikijs/langs/${lang}\`)` — Vite needs a static-ish hint to code-split; if Vite warns/fails on the fully-dynamic template, switch to a small explicit map `LANG_LOADERS: Record<string, () => Promise<unknown>> = { typescript: () => import('@shikijs/langs/typescript'), ... }` for the ~37 langs (more verbose but Vite-friendly). Use whichever builds cleanly — verify with `npm run build`.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck` → 0. (Shiki types resolve in the renderer tsconfig.)

- [ ] **Step 7: Commit**

```bash
git add src/renderer/files/fuzzy.ts src/renderer/files/fuzzy.test.ts src/renderer/files/highlighter.ts
git commit -m "feat: renderer fuzzy scorer + Shiki highlighter (JS engine, lazy langs)"
```

---

## Task 6: Renderer UI — store + FileFinder + SearchPanel + FileViewer + App

**Files:** `src/renderer/store/filesStore.ts`; `src/renderer/ui/FileFinder.tsx`, `SearchPanel.tsx`, `FileViewer.tsx`; `src/renderer/App.tsx`; Test `src/renderer/ui/FileFinder.browser.test.tsx`

- [ ] **Step 1: Create `src/renderer/store/filesStore.ts`**

```ts
import { create } from 'zustand'
import type { FileContent, SearchFileResult, SearchOptions } from '@shared/files'

interface FilesStore {
  files: string[]
  loaded: boolean
  viewer: FileContent | null
  results: SearchFileResult[]
  searching: boolean
  loadFiles: () => Promise<void>
  openFile: (path: string) => Promise<void>
  closeViewer: () => void
  search: (query: string, opts: SearchOptions) => Promise<void>
}

export const useFiles = create<FilesStore>((set) => ({
  files: [], loaded: false, viewer: null, results: [], searching: false,
  loadFiles: async () => { const files = await window.term.invoke('files:list', undefined); set({ files, loaded: true }) },
  openFile: async (path) => { const viewer = await window.term.invoke('files:read', { path }); set({ viewer }) },
  closeViewer: () => set({ viewer: null }),
  search: async (query, opts) => { set({ searching: true }); try { set({ results: await window.term.invoke('files:search', { query, opts }) }) } finally { set({ searching: false }) } },
}))
```

- [ ] **Step 2: Create `src/renderer/ui/FileViewer.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useFiles } from '../store/filesStore'
import { highlight } from '../files/highlighter'

export function FileViewer() {
  const viewer = useFiles((s) => s.viewer)
  const close = useFiles((s) => s.closeViewer)
  const [html, setHtml] = useState('')
  useEffect(() => {
    setHtml('')
    if (!viewer || viewer.binary) return
    let alive = true
    void highlight(viewer.content, viewer.path).then((h) => { if (alive) setHtml(h) }).catch(() => {})
    return () => { alive = false }
  }, [viewer])
  if (!viewer) return null
  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-zinc-950" onClick={close}>
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2 text-sm" onClick={(e) => e.stopPropagation()}>
        <span className="font-mono text-xs">{viewer.path}</span>
        {viewer.truncated && <span className="text-[10px] text-amber-400">(truncado)</span>}
        <button onClick={close} className="ml-auto text-xs text-zinc-400">fechar</button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2 text-xs" onClick={(e) => e.stopPropagation()}>
        {viewer.binary ? <div className="text-zinc-500">(arquivo binário)</div>
          : html ? <div className="shiki-host" dangerouslySetInnerHTML={{ __html: html }} />
          : <pre className="whitespace-pre font-mono text-zinc-300">{viewer.content}</pre>}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create `src/renderer/ui/FileFinder.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react'
import { useFiles } from '../store/filesStore'
import { fuzzyFilter } from '../files/fuzzy'

export function FileFinder({ onClose }: { onClose: () => void }) {
  const { files, loaded, loadFiles, openFile } = useFiles()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  useEffect(() => { if (!loaded) void loadFiles() }, [loaded, loadFiles])
  const results = useMemo(() => (q ? fuzzyFilter(q, files) : files.slice(0, 200).map((path) => ({ path, score: 0, positions: [] as number[] }))), [q, files])

  function pick(path: string) { void openFile(path); onClose() }
  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { setActive((a) => Math.min(a + 1, results.length - 1)); e.preventDefault() }
    else if (e.key === 'ArrowUp') { setActive((a) => Math.max(a - 1, 0)); e.preventDefault() }
    else if (e.key === 'Enter' && results[active]) pick(results[active].path)
    else if (e.key === 'Escape') onClose()
  }
  return (
    <div className="absolute inset-0 z-50 flex justify-center bg-black/50 pt-20" onClick={onClose}>
      <div className="h-fit max-h-[70vh] w-[560px] overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900" onClick={(e) => e.stopPropagation()}>
        <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setActive(0) }} onKeyDown={onKey} placeholder="buscar arquivo…" className="w-full bg-zinc-800 px-3 py-2 text-sm outline-none" />
        <div className="max-h-[60vh] overflow-auto">
          {results.map((r, i) => {
            const pos = new Set(r.positions)
            return (
              <div key={r.path} onClick={() => pick(r.path)} className={`cursor-pointer px-3 py-1 font-mono text-xs ${i === active ? 'bg-sky-900/50' : ''}`}>
                {r.path.split('').map((ch, j) => <span key={j} className={pos.has(j) ? 'text-sky-300' : 'text-zinc-300'}>{ch}</span>)}
              </div>
            )
          })}
          {results.length === 0 && <div className="px-3 py-2 text-xs text-zinc-600">nada encontrado</div>}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create `src/renderer/ui/SearchPanel.tsx`**

```tsx
import { useState } from 'react'
import { useFiles } from '../store/filesStore'

export function SearchPanel({ onClose }: { onClose: () => void }) {
  const { results, searching, search, openFile } = useFiles()
  const [q, setQ] = useState('')
  const [opts, setOpts] = useState({ regex: false, caseSensitive: false, wholeWord: false })
  const toggle = (k: keyof typeof opts) => setOpts((o) => ({ ...o, [k]: !o[k] }))
  return (
    <div className="absolute inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="flex h-full w-[480px] flex-col border-l border-zinc-700 bg-zinc-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-1 border-b border-zinc-800 p-2">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void search(q, opts) }} placeholder="buscar nos arquivos…" className="flex-1 rounded bg-zinc-800 px-2 py-1 text-sm outline-none" />
          <button onClick={() => toggle('caseSensitive')} className={`rounded px-1 text-xs ${opts.caseSensitive ? 'bg-sky-700 text-white' : 'bg-zinc-800 text-zinc-400'}`} title="case">Aa</button>
          <button onClick={() => toggle('wholeWord')} className={`rounded px-1 text-xs ${opts.wholeWord ? 'bg-sky-700 text-white' : 'bg-zinc-800 text-zinc-400'}`} title="whole word">W</button>
          <button onClick={() => toggle('regex')} className={`rounded px-1 text-xs ${opts.regex ? 'bg-sky-700 text-white' : 'bg-zinc-800 text-zinc-400'}`} title="regex">.*</button>
          <button onClick={() => void search(q, opts)} className="rounded bg-emerald-700 px-2 text-xs text-white">buscar</button>
          <button onClick={onClose} className="text-xs text-zinc-400">×</button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-1 text-xs">
          {searching && <div className="px-2 py-1 text-zinc-500">buscando…</div>}
          {!searching && results.length === 0 && <div className="px-2 py-1 text-zinc-600">sem resultados</div>}
          {results.map((f) => (
            <div key={f.path} className="mb-1">
              <div className="cursor-pointer px-2 py-0.5 font-mono text-zinc-300 hover:bg-zinc-800" onClick={() => void openFile(f.path)}>{f.path} <span className="text-zinc-600">({f.matches.length})</span></div>
              {f.matches.slice(0, 20).map((m, i) => (
                <div key={i} className="cursor-pointer truncate pl-6 pr-2 font-mono text-zinc-500 hover:bg-zinc-800" onClick={() => void openFile(f.path)}><span className="text-zinc-600">{m.line}</span> {m.text.trim()}</div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Modify `src/renderer/App.tsx`** — buttons + keybindings + panels

Add imports `FileFinder`/`SearchPanel`/`FileViewer`; state `const [showFinder, setShowFinder] = useState(false)` + `const [showSearch, setShowSearch] = useState(false)`. Add a global key listener effect:
```tsx
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); setShowFinder(true) }
      else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); setShowSearch(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
```
In the discussions row add two buttons: `<button onClick={() => setShowFinder(true)} ...>Arquivos</button>` and `<button onClick={() => setShowSearch(true)} ...>Buscar</button>`. Render near other modals: `{showFinder && <FileFinder onClose={() => setShowFinder(false)} />}`, `{showSearch && <SearchPanel onClose={() => setShowSearch(false)} />}`, and `<FileViewer />` (always mounted; renders null when no viewer).

- [ ] **Step 6: Write component test `src/renderer/ui/FileFinder.browser.test.tsx`**

```tsx
import { render } from 'vitest-browser-react'
import { expect, test, vi, beforeEach } from 'vitest'
import { FileFinder } from './FileFinder'
import { useFiles } from '../store/filesStore'

beforeEach(() => {
  ;(window as any).term = { invoke: vi.fn().mockResolvedValue(['src/app.ts', 'src/main.ts', 'README.md']) }
  useFiles.setState({ files: ['src/app.ts', 'src/main.ts', 'README.md'], loaded: true, viewer: null, results: [], searching: false })
})

test('filtra fuzzy ao digitar', async () => {
  const screen = await render(<FileFinder onClose={() => {}} />)
  const input = screen.getByPlaceholder('buscar arquivo…')
  await input.fill('app')
  await expect.element(screen.getByText(/app\.ts/)).toBeVisible()
})
```
NOTE: FileFinder renders each path char-by-char in spans, so `getByText('src/app.ts')` won't match a single node. Use `screen.getByText('app', { exact: false })`? That also won't work across spans. SIMPLER: assert the finder shows a row for app.ts by checking the container text includes 'app.ts' — `await expect.element(screen.container).toHaveTextContent('app.ts')` (textContent concatenates the spans). Adjust the test to assert container text contains 'app.ts' after filtering, and that 'README.md' is filtered out. Write it that way.

- [ ] **Step 7: Verify**

Run: `npm run typecheck && npm run test:unit && npm run test:component && npm run build`
Expected: all green. CRITICAL: `npm run build` must succeed WITH Shiki — confirm the renderer bundles Shiki + the dynamic lang import works (if the template dynamic import fails the build, switch highlighter.ts to the explicit LANG_LOADERS map per Task 5 NOTE). Confirm no Shiki import leaked into main (grep out/main for shiki → none).

- [ ] **Step 8: Commit**

```bash
git add src/renderer
git commit -m "feat: file finder + search panel + file viewer (Shiki) + keybindings"
```

---

## Task 7: E2E + final verification

**Files:** `e2e/files.spec.ts`

- [ ] **Step 1: Create `e2e/files.spec.ts`**

```ts
import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import which from 'which'

const git = which.sync('git', { nothrow: true })
test.skip(!git, 'git required')
test('file finder lista e abre um arquivo do projeto', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'maestro-e2e-'))
  const proj = mkdtempSync(join(tmpdir(), 'maestro-proj-'))
  execFileSync(git!, ['init', '-q'], { cwd: proj })
  mkdirSync(join(proj, 'src'))
  writeFileSync(join(proj, 'src', 'widget.ts'), 'export const widget = 42\n')

  const app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`] })
  await app.evaluate(async ({ dialog }, dir) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] }) }, proj)
  const win = await app.firstWindow()
  await win.waitForSelector('text=Layout', { timeout: 20000 })
  await win.getByRole('button', { name: 'Abrir projeto ▾' }).click()
  await win.getByRole('button', { name: 'Abrir pasta…' }).click()
  await win.getByRole('button', { name: 'Arquivos', exact: true }).click()
  await win.getByPlaceholder('buscar arquivo…').fill('widget')
  await win.getByText(/widget\.ts/).first().click()
  await expect(win.getByText(/export const widget/)).toBeVisible({ timeout: 10000 })
  await app.close()
})
```
NOTE: the finder rows render chars in spans, but Playwright's `getByText(/widget\.ts/)` matches against accessible text which concatenates child text — it should match the row. If it doesn't, target the row via the input's sibling list and click the first row; keep the assertion that the viewer shows `export const widget`.

- [ ] **Step 2: Build + run E2E**

Run: `npm run build && npm run test:e2e`
Expected: all specs pass (terminal, profiles, discussion, queen, git, files).

- [ ] **Step 3: Final verification**

Run: `npm run typecheck && npm run test:unit && npm run test:component && npm run build && npm run test:e2e`
Expected: typecheck 0; unit green; component green; build clean; e2e all pass. `git status --porcelain` empty.

- [ ] **Step 4: Commit**

```bash
git add e2e/files.spec.ts
git commit -m "test: e2e file finder + final verification"
```

---

## Self-Review (preenchido)

**Cobertura da spec:**
- §3 modelo → T1. §4.1 FileService → T3. §4.2 parseGrep → T2. §4.3 fuzzy → T5. §4.4 Shiki → T5. §4.5 IPC → T4. §4.6 UI → T6. ✔
- §5 fluxos → T6 (finder local fuzzy, search IPC). §6 erros → T3 (regex inválida throw→handler catch→[], binário, truncado), T4 (sem projeto), T5/T6 (Shiki fallback pro <pre>). §7 testes → T2/T3/T5 (unit+integration real repo), T6 (component), T7 (e2e). ✔
- Shiki só renderer (T1 install nota; T5 import). git respeita .gitignore (T3 ls-files/grep; integration prova exclusão do ignorado). ✔

**Placeholder scan:** sem TBD/TODO; código completo. (NOTES: dynamic-import do Shiki → fallback p/ LANG_LOADERS se Vite reclamar [verificável por build]; ajuste do seletor do component/e2e p/ chars-em-spans → asserir textContent — instruções verificáveis, não placeholders.)

**Consistência de tipos:** `SearchFileResult/SearchMatch/SearchOptions/FileContent` (T1) usados em T2(parseGrep)/T3(FileService)/T6(store). Canais `files:*` (T1 ipc) ↔ handlers (T4) ↔ store invoke (T6). `parseGrep` (T2) ↔ FileService.search (T3). `fuzzyFilter`→`FuzzyResult` (T5) ↔ FileFinder (T6). `highlight(code,path)` (T5) ↔ FileViewer (T6). `currentProjectRoot` (reusado do #6) ↔ files handlers (T4). ✔

**Risco anotado:** Shiki dynamic `import(\`@shikijs/langs/${lang}\`)` pode não code-split limpo no Vite → fallback explícito LANG_LOADERS (T5 NOTE), confirmado por `npm run build` (T6 Step 7). git grep `-F`/`-E`/`-w` + parse `path:line:text` validados pela integration real (T3).
```
