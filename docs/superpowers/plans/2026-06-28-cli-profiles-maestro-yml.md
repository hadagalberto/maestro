# CLI Profiles + maestro.yml Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CLI profiles (built-in presets + per-user global + per-project `maestro.yml`, merged), a project (open-folder) concept, a profile picker for new terminals, autoStart, live reload via `fs.watchFile`, and VS Code-style workspace trust gating project-origin spawns at the main-process `pty:create` chokepoint.

**Architecture:** Main process gains `maestroConfig` (yaml+zod parse/validate/scaffold), `trust` (pure path-trust resolution), `maestroWatcher` (fs.watchFile), `projectManager` (open/recent/current + effective-profile merge), an extended `ConfigStore` (schemaVersion 2) and `ipcRouter` (new channels + trust gate). Renderer gains a `projectStore`, a profile picker, project bar, restricted-mode banner, global-profiles panel, and maestro-problems UI.

**Tech Stack:** yaml ^2.9.0 (eemeli, main-only), zod 4 (already), electron-store 11, node-pty (utilityProcess, unchanged), React 19 + zustand 5 + Tailwind 4, vitest (+Browser Mode) + Playwright.

**Spec:** `docs/superpowers/specs/2026-06-28-cli-profiles-maestro-yml-design.md`

---

## File Structure

```
+ src/shared/presets.ts        PROFILE_PRESETS (built-in profiles)
~ src/shared/types.ts          Profile, ProfileEntry, TrustConfig, AppConfig(v2), PaneConfig(+color,profileId)
~ src/shared/schemas.ts        profileEntrySchema, maestroConfigSchema, ptyCreate(+origin,projectRoot refine)
~ src/shared/ipc.ts            new request channels + app-event channels (profiles/project/trust changed)
+ src/main/trust.ts            canonical/isUnder/isTrusted (security core)
+ src/main/maestroConfig.ts    loadMaestroConfig/scaffoldMaestroConfig
+ src/main/profileMerge.ts     mergeProfiles (presets+global+project -> Profile[])
+ src/main/maestroWatcher.ts   watchFile wrapper
+ src/main/projectManager.ts   open/recent/current + effective profiles + watcher wiring
~ src/main/configStore.ts      v2 fields + migrate
~ src/main/ipcRouter.ts        new handlers + trust gate at pty:create
~ src/main/index.ts            wire projectManager + app-event pushes
~ src/preload/index.ts         generic on(appEvent, cb)
+ src/renderer/store/projectStore.ts  currentProject/profiles/trusted/problems
+ src/renderer/ui/ProjectBar.tsx
+ src/renderer/ui/ProfilePicker.tsx
+ src/renderer/ui/RestrictedBanner.tsx
+ src/renderer/ui/GlobalProfiles.tsx
+ src/renderer/ui/MaestroProblems.tsx
~ src/renderer/ui/Toolbar.tsx  open picker
~ src/renderer/ui/Sidebar.tsx  color dot
~ src/renderer/App.tsx         wire project/profiles/trust/autoStart
+ e2e/fixtures/sample/maestro.yml
~ e2e/profiles.spec.ts
```

---

## Task 1: Add `yaml` dependency + presets constant

**Files:** Modify `package.json`; Create `src/shared/presets.ts`

- [ ] **Step 1: Install yaml**

Run: `npm install yaml@^2.9.0`
Expected: adds `"yaml": "^2.9.0"` to dependencies; no errors.

- [ ] **Step 2: Create `src/shared/presets.ts`**

```ts
import type { ProfileEntry } from './types'

// Built-in profile templates. Keyed by id. name defaults to id when omitted.
export const PROFILE_PRESETS: Record<string, ProfileEntry> = {
  claude:   { command: 'claude',   args: [], color: '#d97757' },
  codex:    { command: 'codex',    args: [], color: '#10a37f' },
  opencode: { command: 'opencode', args: [], color: '#f59e0b' },
  amp:      { command: 'amp',      args: [], color: '#8b5cf6' },
  shell: {
    command: process.platform === 'win32' ? 'powershell.exe' : 'bash',
    args: [], color: '#6e7681',
  },
}
```

- [ ] **Step 3: Verify install**

Run: `npm ls yaml --depth=0`
Expected: `yaml@2.9.x`. (presets.ts won't typecheck until Task 2 adds `ProfileEntry`; that's fine — committed together in Task 2. Do NOT commit yet.)

---

## Task 2: Shared contract — types, schemas, IPC channels

**Files:** Modify `src/shared/types.ts`, `src/shared/schemas.ts`, `src/shared/ipc.ts`; Test `src/shared/schemas.profiles.test.ts`

- [ ] **Step 1: Rewrite `src/shared/types.ts`**

```ts
export type LayoutKind = 'two' | 'three' | 'quad'

export interface PaneConfig {
  id: string
  name: string
  command: string
  args?: string[]
  cwd: string
  env?: Record<string, string>
  color?: string
  profileId?: string
}

// Shape stored in maestro.yml profiles and in globalProfiles. name defaults to the map key.
export interface ProfileEntry {
  name?: string
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  autoStart?: boolean
  color?: string
  disabled?: boolean
}

// Resolved profile presented to the renderer.
export interface Profile {
  id: string
  name: string
  command: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
  autoStart: boolean
  color?: string
  disabled?: boolean
  source: 'preset' | 'global' | 'project'
}

export interface TrustConfig { trustedFolders: string[]; deniedFolders: string[] }

export interface AppConfig {
  schemaVersion: number
  activeLayout: LayoutKind
  panes: PaneConfig[]
  layoutSizes: Record<string, number[]>
  settings: { fontFamily: string; fontSize: number; scrollback: number; theme: 'system' | 'light' | 'dark' }
  globalProfiles: Record<string, ProfileEntry>
  recentProjects: string[]
  currentProject: string | null
  trust: TrustConfig
}

export const DEFAULT_CONFIG: AppConfig = {
  schemaVersion: 2,
  activeLayout: 'two',
  panes: [],
  layoutSizes: {},
  settings: { fontFamily: 'JetBrains Mono, monospace', fontSize: 13, scrollback: 5000, theme: 'system' },
  globalProfiles: {},
  recentProjects: [],
  currentProject: null,
  trust: { trustedFolders: [], deniedFolders: [] },
}

export type ConfigProblem =
  | { kind: 'syntax'; line: number; col: number; message: string }
  | { kind: 'schema'; path: string; message: string }
```

- [ ] **Step 2: Rewrite `src/shared/schemas.ts`**

```ts
import { z } from 'zod'

export const ptyCreate = z.object({
  id: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  cwd: z.string().min(1),
  env: z.record(z.string(), z.string()).optional(),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  origin: z.enum(['user', 'project']).default('user'),
  projectRoot: z.string().optional(),
}).refine((v) => v.origin !== 'project' || (v.projectRoot != null && v.projectRoot.length > 0), {
  message: 'projectRoot is required when origin is "project"',
  path: ['projectRoot'],
})
export const ptyWrite = z.object({ id: z.string().min(1), data: z.string() })
export const ptyResize = z.object({ id: z.string().min(1), cols: z.number().int().positive(), rows: z.number().int().positive() })
export const ptyKill = z.object({ id: z.string().min(1) })
export const configSet = z.object({ patch: z.record(z.string(), z.unknown()) })
export const scrollbackSave = z.object({ id: z.string().min(1), data: z.string() })
export const scrollbackLoad = z.object({ id: z.string().min(1) })
export const shellOpen = z.object({ url: z.url() })

export const profileEntrySchema = z.object({
  name: z.string().optional(),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  autoStart: z.boolean().default(false),
  color: z.string().optional(),
  disabled: z.boolean().optional(),
})
export const maestroConfigSchema = z.object({
  version: z.literal(1),
  defaultProfile: z.string().optional(),
  profiles: z.record(z.string(), profileEntrySchema),
})

export const openPath = z.object({ path: z.string().min(1) })
export const setGlobalProfiles = z.object({ profiles: z.record(z.string(), profileEntrySchema) })
export const trustPath = z.object({ path: z.string().min(1) })

export const schemaByChannel = {
  'pty:create': ptyCreate,
  'pty:write': ptyWrite,
  'pty:resize': ptyResize,
  'pty:kill': ptyKill,
  'config:set': configSet,
  'scrollback:save': scrollbackSave,
  'scrollback:load': scrollbackLoad,
  'shell:openExternal': shellOpen,
  'project:openPath': openPath,
  'profiles:setGlobal': setGlobalProfiles,
  'maestro:scaffold': trustPath,
  'trust:get': trustPath,
  'trust:grant': trustPath,
  'trust:grantParent': trustPath,
  'trust:revoke': trustPath,
} as const
```
NOTE: zod 4 uses `z.url()` (not the deprecated `z.string().url()`) — this also fixes a deprecation in the existing `shellOpen`.

- [ ] **Step 3: Rewrite `src/shared/ipc.ts`**

```ts
import type { AppConfig, PaneConfig, Profile, ConfigProblem, ProfileEntry } from './types'

export interface ProjectState {
  currentProject: string | null
  recentProjects: string[]
  trusted: boolean
  profiles: Profile[]
  problems: ConfigProblem[]
  hasMaestroFile: boolean
}

export interface IpcRequest {
  'pty:create': { args: { id: string; command: string; args?: string[]; cwd: string; env?: Record<string,string>; cols: number; rows: number; origin?: 'user'|'project'; projectRoot?: string }; result: void }
  'pty:write':  { args: { id: string; data: string }; result: void }
  'pty:resize': { args: { id: string; cols: number; rows: number }; result: void }
  'pty:kill':   { args: { id: string }; result: void }
  'config:get': { args: undefined; result: AppConfig }
  'config:set': { args: { patch: Partial<AppConfig> }; result: void }
  'scrollback:save': { args: { id: string; data: string }; result: void }
  'scrollback:load': { args: { id: string }; result: string | null }
  'shell:openExternal': { args: { url: string }; result: void }
  'project:open': { args: undefined; result: ProjectState | null }      // dialog; null if cancelled
  'project:openPath': { args: { path: string }; result: ProjectState }
  'project:state': { args: undefined; result: ProjectState }
  'profiles:setGlobal': { args: { profiles: Record<string, ProfileEntry> }; result: ProjectState }
  'maestro:scaffold': { args: { path: string }; result: ProjectState }
  'trust:get': { args: { path: string }; result: boolean }
  'trust:grant': { args: { path: string }; result: ProjectState }
  'trust:grantParent': { args: { path: string }; result: ProjectState }
  'trust:revoke': { args: { path: string }; result: ProjectState }
}
export type IpcChannel = keyof IpcRequest

export interface IpcEventPayloads {
  'pty:data': { data: string }
  'pty:exit': { code: number; reason?: string }
}
export const ptyDataChannel = (id: string) => `pty:data:${id}` as const
export const ptyExitChannel = (id: string) => `pty:exit:${id}` as const

// app-wide push events (main -> renderer), fixed channel names
export type AppEvent = 'project:changed'
export interface AppEventPayloads { 'project:changed': ProjectState }

export const TRUST_REQUIRED = 'TRUST_REQUIRED'

export type { AppConfig, PaneConfig, Profile, ConfigProblem, ProfileEntry }
```

- [ ] **Step 4: Write failing test `src/shared/schemas.profiles.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { maestroConfigSchema, ptyCreate, profileEntrySchema } from './schemas'

describe('maestroConfigSchema', () => {
  it('aceita config válido e aplica defaults', () => {
    const r = maestroConfigSchema.safeParse({ version: 1, profiles: { claude: { command: 'claude' } } })
    expect(r.success).toBe(true)
    if (r.success) { expect(r.data.profiles.claude.args).toEqual([]); expect(r.data.profiles.claude.autoStart).toBe(false) }
  })
  it('rejeita version != 1', () => {
    expect(maestroConfigSchema.safeParse({ version: 2, profiles: {} }).success).toBe(false)
  })
  it('rejeita profile sem command', () => {
    expect(profileEntrySchema.safeParse({ args: [] }).success).toBe(false)
  })
})

describe('ptyCreate origin/projectRoot refine', () => {
  const base = { id: 'a', command: 'bash', cwd: '/x', cols: 80, rows: 24 }
  it('origin user dispensa projectRoot', () => {
    expect(ptyCreate.safeParse({ ...base, origin: 'user' }).success).toBe(true)
  })
  it('origin project exige projectRoot', () => {
    expect(ptyCreate.safeParse({ ...base, origin: 'project' }).success).toBe(false)
    expect(ptyCreate.safeParse({ ...base, origin: 'project', projectRoot: '/x' }).success).toBe(true)
  })
  it('default origin = user', () => {
    const r = ptyCreate.safeParse(base)
    expect(r.success && r.data.origin).toBe('user')
  })
})
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm run test:unit && npm run typecheck`
Expected: new tests pass; existing config tests will FAIL until Task 6 (ConfigStore migrate) — that's expected because DEFAULT_CONFIG changed. If `configStore.test.ts` fails on `schemaVersion`/missing fields, leave it; Task 6 fixes it. The schemas/profiles tests and typecheck of shared/ must pass. (If typecheck fails because `presets.ts` references types now present — it should pass now.)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/shared
git commit -m "feat: shared contract for profiles/projects/trust (types, schemas, ipc) + yaml dep"
```

---

## Task 3: `trust.ts` — security core (path trust resolution)

**Files:** Create `src/main/trust.ts`; Test `src/main/trust.test.ts`

- [ ] **Step 1: Write failing test `src/main/trust.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest'
import { isTrusted, isUnder } from './trust'

// realpath is mocked to identity (no FS) so tests are deterministic and cross-platform.
vi.mock('node:fs', () => ({ realpathSync: { native: (p: string) => p } }))

const T = (trusted: string[], denied: string[] = []) => ({ trustedFolders: trusted, deniedFolders: denied })

describe('isUnder', () => {
  it('mesma pasta conta', () => expect(isUnder('/a/b', '/a/b')).toBe(true))
  it('subpasta conta', () => expect(isUnder('/a/b/c', '/a/b')).toBe(true))
  it('prefixo de string que NÃO é subpasta não conta', () => expect(isUnder('/a/bc', '/a/b')).toBe(false))
  it('fora não conta', () => expect(isUnder('/x', '/a/b')).toBe(false))
})

describe('isTrusted', () => {
  it('herda do pai confiável', () => expect(isTrusted('/a/b/c', T(['/a']))).toBe(true))
  it('não confiável por padrão', () => expect(isTrusted('/a/b', T([]))).toBe(false))
  it('denied vence trusted', () => expect(isTrusted('/a/b', T(['/a'], ['/a/b']))).toBe(false))
  it('denied só afeta subárvore negada', () => expect(isTrusted('/a/c', T(['/a'], ['/a/b']))).toBe(true))
})
```

- [ ] **Step 2: Run to see fail**

Run: `npx vitest run src/main/trust.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/main/trust.ts`**

```ts
import path from 'node:path'
import fs from 'node:fs'
import type { TrustConfig } from '@shared/types'

// Canonicalize: resolve symlinks/junctions/8.3/\\?\ when the path exists, else lexical resolve.
// Case-fold on win32 so trust comparison is case-insensitive there.
export function canonical(p: string): string {
  let resolved: string
  try { resolved = fs.realpathSync.native(path.resolve(p)) }
  catch { resolved = path.resolve(p) }
  resolved = resolved.replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

// Containment by path segments (NOT string prefix): '/a/bc' is NOT under '/a/b'.
export function isUnder(child: string, root: string): boolean {
  const c = canonical(child)
  const r = canonical(root)
  if (c === r) return true
  const rel = path.relative(r, c)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

export function isTrusted(target: string, trust: TrustConfig): boolean {
  if (trust.deniedFolders.some((d) => isUnder(target, d))) return false
  return trust.trustedFolders.some((t) => isUnder(target, t))
}
```

- [ ] **Step 4: Run to see pass**

Run: `npx vitest run src/main/trust.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/trust.ts src/main/trust.test.ts
git commit -m "feat: trust.ts path-trust resolution (realpath canonical + segment containment)"
```

---

## Task 4: `maestroConfig.ts` — parse / validate / scaffold

**Files:** Create `src/main/maestroConfig.ts`; Test `src/main/maestroConfig.test.ts`

- [ ] **Step 1: Write failing test `src/main/maestroConfig.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const files = new Map<string, string>()
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async (p: string) => { if (!files.has(p)) { const e: any = new Error('ENOENT'); e.code = 'ENOENT'; throw e } return files.get(p) }),
  writeFile: vi.fn(async (p: string, c: string) => { files.set(p, c) }),
}))
import { loadMaestroConfig, scaffoldMaestroConfig } from './maestroConfig'

beforeEach(() => files.clear())

describe('loadMaestroConfig', () => {
  it('ausente -> {ok:absent}', async () => {
    expect(await loadMaestroConfig('/no.yml')).toEqual({ ok: 'absent' })
  })
  it('válido -> profiles', async () => {
    files.set('/m.yml', 'version: 1\nprofiles:\n  claude:\n    command: claude\n')
    const r = await loadMaestroConfig('/m.yml')
    expect(r.ok).toBe(true)
    if (r.ok === true) expect(r.profiles.claude.command).toBe('claude')
  })
  it('erro de sintaxe -> problem syntax com linha', async () => {
    files.set('/m.yml', 'version: 1\nprofiles:\n  claude:\n   command: "unterminated\n')
    const r = await loadMaestroConfig('/m.yml')
    expect(r.ok).toBe(false)
    if (r.ok === false) expect(r.problems[0].kind).toBe('syntax')
  })
  it('erro de schema -> problem schema com path', async () => {
    files.set('/m.yml', 'version: 1\nprofiles:\n  claude:\n    args: []\n') // sem command
    const r = await loadMaestroConfig('/m.yml')
    expect(r.ok).toBe(false)
    if (r.ok === false) { expect(r.problems[0].kind).toBe('schema'); expect(r.problems[0].path).toContain('claude') }
  })
  it('vazio -> problem', async () => {
    files.set('/m.yml', '\n')
    const r = await loadMaestroConfig('/m.yml')
    expect(r.ok).toBe(false)
  })
})

describe('scaffoldMaestroConfig', () => {
  it('escreve yaml parseável de volta', async () => {
    await scaffoldMaestroConfig('/m.yml')
    const r = await loadMaestroConfig('/m.yml')
    expect(r.ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run to see fail**

Run: `npx vitest run src/main/maestroConfig.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/main/maestroConfig.ts`**

```ts
import { readFile, writeFile } from 'node:fs/promises'
import { parseDocument, stringify, type YAMLParseError } from 'yaml'
import { maestroConfigSchema } from '@shared/schemas'
import type { ConfigProblem, ProfileEntry } from '@shared/types'

export type LoadResult =
  | { ok: 'absent' }
  | { ok: true; profiles: Record<string, Required<Pick<ProfileEntry,'command'>> & ProfileEntry>; defaultProfile?: string }
  | { ok: false; problems: ConfigProblem[] }

export async function loadMaestroConfig(file: string): Promise<LoadResult> {
  let text: string
  try { text = await readFile(file, 'utf8') }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ok: 'absent' }; throw e }

  const doc = parseDocument(text, { prettyErrors: true, uniqueKeys: true, strict: true })
  if (doc.errors.length) {
    return { ok: false, problems: doc.errors.map((e: YAMLParseError): ConfigProblem => ({
      kind: 'syntax', line: e.linePos?.[0]?.line ?? 0, col: e.linePos?.[0]?.col ?? 0, message: e.message,
    })) }
  }
  const data = doc.toJS()
  if (data == null) return { ok: false, problems: [{ kind: 'syntax', line: 1, col: 1, message: 'maestro.yml está vazio' }] }

  const parsed = maestroConfigSchema.safeParse(data)
  if (!parsed.success) {
    return { ok: false, problems: parsed.error.issues.map((i): ConfigProblem => ({
      kind: 'schema', path: i.path.join('.') || '(root)', message: i.message,
    })) }
  }
  return { ok: true, profiles: parsed.data.profiles, defaultProfile: parsed.data.defaultProfile }
}

export async function scaffoldMaestroConfig(file: string): Promise<void> {
  const starter = {
    version: 1,
    defaultProfile: 'claude',
    profiles: {
      claude: { command: 'claude', args: [] },
      codex: { command: 'codex', args: [] },
    },
  }
  const header = '# maestro.yml — perfis de CLI por projeto (config as code). Edite à mão.\n'
  await writeFile(file, header + stringify(starter), 'utf8')
}
```

- [ ] **Step 4: Run to see pass**

Run: `npx vitest run src/main/maestroConfig.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/maestroConfig.ts src/main/maestroConfig.test.ts
git commit -m "feat: maestroConfig parse/validate/scaffold (yaml parseDocument + zod, friendly problems)"
```

---

## Task 5: `profileMerge.ts` — merge presets + global + project

**Files:** Create `src/main/profileMerge.ts`; Test `src/main/profileMerge.test.ts`

- [ ] **Step 1: Write failing test `src/main/profileMerge.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { mergeProfiles } from './profileMerge'

const presets = { shell: { command: 'bash', color: '#111' }, claude: { command: 'claude' } }

describe('mergeProfiles', () => {
  it('inclui presets quando não há global/projeto', () => {
    const out = mergeProfiles(presets, {}, {})
    const ids = out.map((p) => p.id).sort()
    expect(ids).toContain('claude'); expect(ids).toContain('shell')
    expect(out.find((p) => p.id === 'claude')!.source).toBe('preset')
  })
  it('global sobrescreve preset; projeto sobrescreve global', () => {
    const out = mergeProfiles(presets, { claude: { command: 'claude-global' } }, { claude: { command: 'claude-proj' } })
    const c = out.find((p) => p.id === 'claude')!
    expect(c.command).toBe('claude-proj'); expect(c.source).toBe('project')
  })
  it('disabled remove o perfil do resultado', () => {
    const out = mergeProfiles(presets, {}, { shell: { command: 'bash', disabled: true } })
    expect(out.find((p) => p.id === 'shell')).toBeUndefined()
  })
  it('name default = id e args default = []', () => {
    const out = mergeProfiles({ x: { command: 'x' } }, {}, {})
    const x = out.find((p) => p.id === 'x')!
    expect(x.name).toBe('x'); expect(x.args).toEqual([])
  })
})
```

- [ ] **Step 2: Run to see fail**

Run: `npx vitest run src/main/profileMerge.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/main/profileMerge.ts`**

```ts
import type { Profile, ProfileEntry } from '@shared/types'

type EntryMap = Record<string, ProfileEntry>

function toProfile(id: string, e: ProfileEntry, source: Profile['source']): Profile {
  return {
    id,
    name: e.name ?? id,
    command: e.command,
    args: e.args ?? [],
    cwd: e.cwd,
    env: e.env,
    autoStart: e.autoStart ?? false,
    color: e.color,
    disabled: e.disabled,
    source,
  }
}

export function mergeProfiles(presets: EntryMap, global: EntryMap, project: EntryMap): Profile[] {
  const byId = new Map<string, Profile>()
  for (const [id, e] of Object.entries(presets)) byId.set(id, toProfile(id, e, 'preset'))
  for (const [id, e] of Object.entries(global)) byId.set(id, toProfile(id, e, 'global'))
  for (const [id, e] of Object.entries(project)) byId.set(id, toProfile(id, e, 'project'))
  return [...byId.values()].filter((p) => !p.disabled)
}
```

- [ ] **Step 4: Run to see pass**

Run: `npx vitest run src/main/profileMerge.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/profileMerge.ts src/main/profileMerge.test.ts
git commit -m "feat: profileMerge (presets<global<project by id, disabled drops, source tag)"
```

---

## Task 6: ConfigStore v2 (new fields + migration)

**Files:** Modify `src/main/configStore.ts`; Modify `src/main/configStore.test.ts`

- [ ] **Step 1: Replace `src/main/configStore.ts`**

```ts
import ElectronStore from 'electron-store'
import { DEFAULT_CONFIG, type AppConfig, type ProfileEntry, type TrustConfig } from '@shared/types'

const Store = (ElectronStore as unknown as { default?: typeof ElectronStore }).default ?? ElectronStore
const CURRENT_SCHEMA = 2

export class ConfigStore {
  private store = new Store<{ config: AppConfig }>({ name: 'maestro' })

  get(): AppConfig {
    const saved = this.store.get('config')
    if (!saved) return DEFAULT_CONFIG
    return this.migrate(saved)
  }

  set(patch: Partial<AppConfig>): void {
    const cur = this.get()
    const next: AppConfig = {
      ...cur,
      ...patch,
      settings: { ...cur.settings, ...(patch.settings ?? {}) },
      trust: { ...cur.trust, ...(patch.trust ?? {}) },
    }
    this.store.set('config', next)
  }

  setGlobalProfiles(profiles: Record<string, ProfileEntry>): void { this.set({ globalProfiles: profiles }) }

  pushRecentProject(p: string): void {
    const cur = this.get()
    const recent = [p, ...cur.recentProjects.filter((x) => x !== p)].slice(0, 10)
    this.set({ recentProjects: recent, currentProject: p })
  }

  grantTrust(p: string): TrustConfig {
    const t = this.get().trust
    const next: TrustConfig = { trustedFolders: [...new Set([...t.trustedFolders, p])], deniedFolders: t.deniedFolders.filter((d) => d !== p) }
    this.set({ trust: next }); return next
  }
  revokeTrust(p: string): TrustConfig {
    const t = this.get().trust
    const next: TrustConfig = { trustedFolders: t.trustedFolders.filter((x) => x !== p), deniedFolders: t.deniedFolders }
    this.set({ trust: next }); return next
  }

  private migrate(cfg: AppConfig): AppConfig {
    if (cfg.schemaVersion === CURRENT_SCHEMA) return cfg
    return {
      ...DEFAULT_CONFIG,
      ...cfg,
      schemaVersion: CURRENT_SCHEMA,
      settings: { ...DEFAULT_CONFIG.settings, ...(cfg.settings ?? {}) },
      globalProfiles: cfg.globalProfiles ?? {},
      recentProjects: cfg.recentProjects ?? [],
      currentProject: cfg.currentProject ?? null,
      trust: cfg.trust ?? { trustedFolders: [], deniedFolders: [] },
    }
  }
}
```
NOTE: the electron-store `name` changes from `'hiveterm'` to `'maestro'` (product rename). Existing dev users start fresh; acceptable pre-1.0.

- [ ] **Step 2: Replace `src/main/configStore.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DEFAULT_CONFIG } from '@shared/types'

const { mockStore, data } = vi.hoisted(() => {
  const data: Record<string, unknown> = {}
  const mockStore = { get store() { return data }, get: (k: string) => data[k], set: vi.fn((k: string, v: unknown) => { data[k] = v }) }
  return { mockStore, data }
})
vi.mock('electron-store', () => ({ default: vi.fn(function () { return mockStore }) }))
import { ConfigStore } from './configStore'

beforeEach(() => { for (const k of Object.keys(data)) delete data[k]; mockStore.set.mockClear() })

describe('ConfigStore v2', () => {
  it('default quando vazio', () => { expect(new ConfigStore().get().schemaVersion).toBe(2) })
  it('migra v1 -> v2 adicionando campos novos', () => {
    data['config'] = { schemaVersion: 1, activeLayout: 'quad', panes: [], layoutSizes: {}, settings: DEFAULT_CONFIG.settings }
    const cs = new ConfigStore()
    expect(cs.get().schemaVersion).toBe(2)
    expect(cs.get().activeLayout).toBe('quad')
    expect(cs.get().globalProfiles).toEqual({})
    expect(cs.get().trust).toEqual({ trustedFolders: [], deniedFolders: [] })
  })
  it('pushRecentProject dedup + cap + define current', () => {
    const cs = new ConfigStore()
    for (let i = 0; i < 12; i++) cs.pushRecentProject('/p' + i)
    cs.pushRecentProject('/p0')
    expect(cs.get().recentProjects.length).toBeLessThanOrEqual(10)
    expect(cs.get().recentProjects[0]).toBe('/p0')
    expect(cs.get().currentProject).toBe('/p0')
  })
  it('grant/revoke trust', () => {
    const cs = new ConfigStore()
    cs.grantTrust('/a'); expect(cs.get().trust.trustedFolders).toContain('/a')
    cs.revokeTrust('/a'); expect(cs.get().trust.trustedFolders).not.toContain('/a')
  })
})
```

- [ ] **Step 3: Run + typecheck**

Run: `npm run test:unit && npm run typecheck`
Expected: configStore tests pass (4); all prior unit tests pass; typecheck 0.

- [ ] **Step 4: Commit**

```bash
git add src/main/configStore.ts src/main/configStore.test.ts
git commit -m "feat: ConfigStore v2 (globalProfiles/recent/current/trust + migrate, store name maestro)"
```

---

## Task 7: `maestroWatcher.ts` + `projectManager.ts`

**Files:** Create `src/main/maestroWatcher.ts`, `src/main/projectManager.ts`; Test `src/main/projectManager.test.ts`

- [ ] **Step 1: Create `src/main/maestroWatcher.ts`**

```ts
import { watchFile, unwatchFile } from 'node:fs'

// Watches a single file (maestro.yml) via polling — robust on Windows + atomic saves, no native/ESM deps.
export class MaestroWatcher {
  private file: string | null = null
  start(file: string, onChange: () => void): void {
    this.stop()
    this.file = file
    watchFile(file, { interval: 1000 }, () => onChange())
  }
  stop(): void {
    if (this.file) { unwatchFile(this.file); this.file = null }
  }
}
```

- [ ] **Step 2: Write failing test `src/main/projectManager.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./maestroConfig', () => ({ loadMaestroConfig: vi.fn() }))
vi.mock('./maestroWatcher', () => ({ MaestroWatcher: class { start = vi.fn(); stop = vi.fn() } }))
import { loadMaestroConfig } from './maestroConfig'
import { ProjectManager } from './projectManager'
import { PROFILE_PRESETS } from '@shared/presets'

function fakeConfig(over: Record<string, unknown> = {}) {
  const state = { globalProfiles: {}, currentProject: null as string | null, recentProjects: [] as string[], trust: { trustedFolders: [] as string[], deniedFolders: [] as string[] }, ...over }
  return {
    get: () => state,
    pushRecentProject: vi.fn((p: string) => { state.currentProject = p; state.recentProjects = [p] }),
  } as any
}

beforeEach(() => (loadMaestroConfig as any).mockReset())

describe('ProjectManager.computeState', () => {
  it('sem projeto -> só presets, sem problems', async () => {
    const pm = new ProjectManager(fakeConfig(), () => {})
    const st = await pm.state()
    expect(st.currentProject).toBeNull()
    expect(st.profiles.some((p) => p.id === 'claude')).toBe(true)
    expect(st.problems).toEqual([])
  })
  it('projeto com maestro.yml válido + trusted', async () => {
    ;(loadMaestroConfig as any).mockResolvedValue({ ok: true, profiles: { api: { command: 'npm', args: ['run','dev'], autoStart: true } } })
    const cfg = fakeConfig({ currentProject: '/proj', trust: { trustedFolders: ['/proj'], deniedFolders: [] } })
    const pm = new ProjectManager(cfg, () => {})
    const st = await pm.state()
    expect(st.trusted).toBe(true)
    expect(st.profiles.find((p) => p.id === 'api')!.source).toBe('project')
    expect(st.hasMaestroFile).toBe(true)
  })
  it('maestro.yml inválido -> problems preenchido', async () => {
    ;(loadMaestroConfig as any).mockResolvedValue({ ok: false, problems: [{ kind: 'schema', path: 'profiles.x', message: 'bad' }] })
    const pm = new ProjectManager(fakeConfig({ currentProject: '/p' }), () => {})
    const st = await pm.state()
    expect(st.problems.length).toBe(1)
  })
})
```

- [ ] **Step 3: Run to see fail**

Run: `npx vitest run src/main/projectManager.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/main/projectManager.ts`**

```ts
import { join } from 'node:path'
import { loadMaestroConfig } from './maestroConfig'
import { MaestroWatcher } from './maestroWatcher'
import { mergeProfiles } from './profileMerge'
import { isTrusted } from './trust'
import { PROFILE_PRESETS } from '@shared/presets'
import type { ConfigStore } from './configStore'
import type { ProjectState } from '@shared/ipc'
import type { ProfileEntry } from '@shared/types'

const MAESTRO_FILE = 'maestro.yml'

export class ProjectManager {
  private watcher = new MaestroWatcher()
  constructor(private config: ConfigStore, private onChanged: (s: ProjectState) => void) {}

  maestroPath(root: string): string { return join(root, MAESTRO_FILE) }

  async open(root: string): Promise<ProjectState> {
    this.config.pushRecentProject(root)
    this.watcher.start(this.maestroPath(root), () => { void this.emit() })
    return this.state()
  }

  private async emit(): Promise<void> { this.onChanged(await this.state()) }

  async state(): Promise<ProjectState> {
    const cfg = this.config.get()
    const root = cfg.currentProject
    const global = cfg.globalProfiles as Record<string, ProfileEntry>
    let projectEntries: Record<string, ProfileEntry> = {}
    let problems: ProjectState['problems'] = []
    let hasMaestroFile = false

    if (root) {
      const res = await loadMaestroConfig(this.maestroPath(root))
      if (res.ok === true) { projectEntries = res.profiles; hasMaestroFile = true }
      else if (res.ok === false) { problems = res.problems; hasMaestroFile = true }
    }
    const profiles = mergeProfiles(PROFILE_PRESETS, global, projectEntries)
    const trusted = root ? isTrusted(root, cfg.trust) : true
    return { currentProject: root, recentProjects: cfg.recentProjects, trusted, profiles, problems, hasMaestroFile }
  }

  stop(): void { this.watcher.stop() }
}
```

- [ ] **Step 5: Run to see pass + typecheck**

Run: `npx vitest run src/main/projectManager.test.ts && npm run typecheck`
Expected: PASS (3 tests); typecheck 0.

- [ ] **Step 6: Commit**

```bash
git add src/main/maestroWatcher.ts src/main/projectManager.ts src/main/projectManager.test.ts
git commit -m "feat: MaestroWatcher (watchFile) + ProjectManager (open/state, effective profiles, trust)"
```

---

## Task 8: IpcRouter new handlers + trust gate + main wiring + preload events

**Files:** Modify `src/main/ipcRouter.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/window.d.ts`

- [ ] **Step 1: Replace `src/main/ipcRouter.ts`**

```ts
import { ipcMain, shell, dialog, type IpcMainInvokeEvent } from 'electron'
import { schemaByChannel } from '@shared/schemas'
import { TRUST_REQUIRED, type IpcChannel, type IpcRequest, type ProjectState } from '@shared/ipc'
import { ConfigStore } from './configStore'
import { PtyHostBridge } from './ptyHostBridge'
import { ProjectManager } from './projectManager'
import { scaffoldMaestroConfig } from './maestroConfig'
import { isTrusted, canonical } from './trust'

export interface RouterDeps {
  config: ConfigStore
  ptyHost: PtyHostBridge
  project: ProjectManager
  isTrustedSender: (e: IpcMainInvokeEvent) => boolean
  scrollback: { save: (id: string, data: string) => void; load: (id: string) => string | null }
}

type Handler<C extends IpcChannel> = (args: IpcRequest[C]['args'], e: IpcMainInvokeEvent) => IpcRequest[C]['result'] | Promise<IpcRequest[C]['result']>

export function registerIpc(deps: RouterDeps): void {
  const handle = <C extends IpcChannel>(channel: C, fn: Handler<C>) => {
    ipcMain.handle(channel, (e, raw) => {
      if (!deps.isTrustedSender(e)) throw new Error('untrusted sender')
      const schema = (schemaByChannel as Record<string, { parse: (v: unknown) => unknown } | undefined>)[channel]
      const args = schema ? schema.parse(raw) : raw
      return fn(args as IpcRequest[C]['args'], e)
    })
  }

  handle('pty:create', (a) => {
    if (a.origin === 'project') {
      const root = a.projectRoot ?? a.cwd
      if (!isTrusted(root, deps.config.get().trust)) {
        const err = new Error(TRUST_REQUIRED) as Error & { code?: string; projectRoot?: string }
        err.code = TRUST_REQUIRED; err.projectRoot = canonical(root); throw err
      }
    }
    deps.ptyHost.spawn(a)
  })
  handle('pty:write', (a) => { deps.ptyHost.write(a.id, a.data) })
  handle('pty:resize', (a) => { deps.ptyHost.resize(a.id, a.cols, a.rows) })
  handle('pty:kill', (a) => { deps.ptyHost.kill(a.id) })
  handle('config:get', () => deps.config.get())
  handle('config:set', (a) => { deps.config.set(a.patch) })
  handle('scrollback:save', (a) => { deps.scrollback.save(a.id, a.data) })
  handle('scrollback:load', (a) => deps.scrollback.load(a.id))
  handle('shell:openExternal', (a) => { void shell.openExternal(a.url) })

  handle('project:open', async (): Promise<ProjectState | null> => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    return deps.project.open(r.filePaths[0])
  })
  handle('project:openPath', (a) => deps.project.open(a.path))
  handle('project:state', () => deps.project.state())
  handle('profiles:setGlobal', async (a) => { deps.config.setGlobalProfiles(a.profiles); return deps.project.state() })
  handle('maestro:scaffold', async (a) => { await scaffoldMaestroConfig(deps.project.maestroPath(a.path)); return deps.project.state() })
  handle('trust:get', (a) => isTrusted(a.path, deps.config.get().trust))
  handle('trust:grant', async (a) => { deps.config.grantTrust(canonical(a.path)); return deps.project.state() })
  handle('trust:grantParent', async (a) => {
    const parent = canonical(a.path).split(/[\\/]/).slice(0, -1).join('/') || canonical(a.path)
    deps.config.grantTrust(parent); return deps.project.state()
  })
  handle('trust:revoke', async (a) => { deps.config.revokeTrust(canonical(a.path)); return deps.project.state() })
}

export function makeSenderGuard(devUrl: string, isPackaged: boolean) {
  return (e: IpcMainInvokeEvent): boolean => {
    const url = e.senderFrame?.url
    if (!url) return false
    if (isPackaged) return url.startsWith('file://')
    return url.startsWith(devUrl) || url.startsWith('file://')
  }
}
```

- [ ] **Step 2: Replace `src/main/index.ts`**

```ts
import { app, BrowserWindow, session } from 'electron'
import { join } from 'node:path'
import { ConfigStore } from './configStore'
import { PtyHostBridge } from './ptyHostBridge'
import { ProjectManager } from './projectManager'
import { registerIpc, makeSenderGuard } from './ipcRouter'
import type { ProjectState } from '@shared/ipc'

const DEV_URL = process.env['ELECTRON_RENDERER_URL'] ?? 'http://localhost:5173'
const scrollbackMem = new Map<string, string>()

let win: BrowserWindow | null = null
const config = new ConfigStore()
const ptyHost = new PtyHostBridge(() => win?.webContents ?? null)
const project = new ProjectManager(config, (s: ProjectState) => {
  if (win && !win.webContents.isDestroyed()) win.webContents.send('project:changed', s)
})

function createWindow(): void {
  win = new BrowserWindow({
    width: 1400, height: 900, show: false, backgroundColor: '#0d1117',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
    },
  })
  win.once('ready-to-show', () => win?.show())
  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(DEV_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((d, cb) =>
    cb({ responseHeaders: { ...d.responseHeaders,
      'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://localhost:5173"],
    } }),
  )
  ptyHost.start()
  registerIpc({
    config, ptyHost, project,
    isTrustedSender: makeSenderGuard(DEV_URL, app.isPackaged),
    scrollback: { save: (id, data) => scrollbackMem.set(id, data), load: (id) => scrollbackMem.get(id) ?? null },
  })
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('before-quit', () => { ptyHost.dispose(); project.stop() })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
```

- [ ] **Step 3: Replace `src/preload/index.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron'
import { ptyDataChannel, ptyExitChannel, type IpcChannel, type IpcRequest, type IpcEventPayloads, type AppEvent, type AppEventPayloads } from '@shared/ipc'

const api = {
  invoke<C extends IpcChannel>(channel: C, args: IpcRequest[C]['args']): Promise<IpcRequest[C]['result']> {
    return ipcRenderer.invoke(channel, args) as Promise<IpcRequest[C]['result']>
  },
  onPtyData(id: string, cb: (p: IpcEventPayloads['pty:data']) => void): () => void {
    const ch = ptyDataChannel(id)
    const h = (_e: Electron.IpcRendererEvent, p: IpcEventPayloads['pty:data']) => cb(p)
    ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h)
  },
  onPtyExit(id: string, cb: (p: IpcEventPayloads['pty:exit']) => void): () => void {
    const ch = ptyExitChannel(id)
    const h = (_e: Electron.IpcRendererEvent, p: IpcEventPayloads['pty:exit']) => cb(p)
    ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h)
  },
  on<E extends AppEvent>(event: E, cb: (p: AppEventPayloads[E]) => void): () => void {
    const h = (_e: Electron.IpcRendererEvent, p: AppEventPayloads[E]) => cb(p)
    ipcRenderer.on(event, h); return () => ipcRenderer.removeListener(event, h)
  },
}

contextBridge.exposeInMainWorld('term', api)
export type TermApi = typeof api
```

- [ ] **Step 4: Verify `src/renderer/window.d.ts` unchanged (still re-exports TermApi)** — it imports `TermApi` from preload; no edit needed. Confirm by reading it.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors. (If `dialog` import unused-warning or similar, fix minimally.)

- [ ] **Step 6: Build sanity**

Run: `npm run build`
Expected: builds; `out/main/index.js` present.

- [ ] **Step 7: Commit**

```bash
git add src/main/ipcRouter.ts src/main/index.ts src/preload/index.ts
git commit -m "feat: IPC project/profiles/trust handlers + trust gate at pty:create + app-event push"
```

---

## Task 9: Renderer `projectStore` + wire pty:create origin

**Files:** Create `src/renderer/store/projectStore.ts`; Modify `src/renderer/term/TerminalPane.tsx`

- [ ] **Step 1: Create `src/renderer/store/projectStore.ts`**

```ts
import { create } from 'zustand'
import type { ProjectState } from '@shared/ipc'

interface ProjectStore extends ProjectState {
  hydrate: () => Promise<void>
  apply: (s: ProjectState) => void
}

const EMPTY: ProjectState = { currentProject: null, recentProjects: [], trusted: true, profiles: [], problems: [], hasMaestroFile: false }

export const useProject = create<ProjectStore>((set) => ({
  ...EMPTY,
  apply: (s) => set(s),
  hydrate: async () => {
    const s = await window.term.invoke('project:state', undefined)
    set(s)
  },
}))
```

- [ ] **Step 2: Modify `TerminalPane.tsx` — pass origin/projectRoot on pty:create**

The component must know whether a pane is project-origin. Add optional fields to the pane prop usage: read `pane.profileId` and the current project. Simplest: the spawn call includes `origin` and `projectRoot` derived from props. Change the `pty:create` invoke (around line 62) to:

```tsx
      await window.term.invoke('pty:create', {
        id: pane.id, command: pane.command, args: pane.args, cwd: pane.cwd,
        env: pane.env, cols: term.cols, rows: term.rows,
        origin: pane.origin ?? 'user', projectRoot: pane.projectRoot,
      })
```

And extend the `PaneConfig` usage: add `origin?: 'user'|'project'` and `projectRoot?: string` to the pane shape the renderer uses. Add these to `PaneConfig` in `src/shared/types.ts`:

```ts
export interface PaneConfig {
  id: string; name: string; command: string; args?: string[]; cwd: string
  env?: Record<string, string>; color?: string; profileId?: string
  origin?: 'user' | 'project'; projectRoot?: string
}
```

Handle `TRUST_REQUIRED`: wrap the `pty:create` invoke in try/catch; on a rejection whose message includes `TRUST_REQUIRED`, write a notice to the terminal and do not throw:

```tsx
      try {
        await window.term.invoke('pty:create', {
          id: pane.id, command: pane.command, args: pane.args, cwd: pane.cwd,
          env: pane.env, cols: term.cols, rows: term.rows,
          origin: pane.origin ?? 'user', projectRoot: pane.projectRoot,
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.includes('TRUST_REQUIRED')) term.writeln('\r\n\x1b[33m[pasta não confiável — confie no projeto para rodar este perfil]\x1b[0m')
        else term.writeln(`\r\n\x1b[31m[falha ao iniciar: ${msg}]\x1b[0m`)
      }
```

- [ ] **Step 3: Typecheck + tests**

Run: `npm run typecheck && npm run test:unit && npm run test:component`
Expected: typecheck 0; unit unchanged green; component (TerminalPane) still passes (the mock `window.term.invoke` resolves undefined, so no throw).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/store/projectStore.ts src/renderer/term/TerminalPane.tsx src/shared/types.ts
git commit -m "feat: projectStore + TerminalPane passes origin/projectRoot and handles TRUST_REQUIRED"
```

---

## Task 10: ProfilePicker + Toolbar + Sidebar color dot

**Files:** Create `src/renderer/ui/ProfilePicker.tsx`; Modify `src/renderer/ui/Toolbar.tsx`, `src/renderer/ui/Sidebar.tsx`

- [ ] **Step 1: Create `src/renderer/ui/ProfilePicker.tsx`**

```tsx
import { useProject } from '../store/projectStore'
import type { Profile } from '@shared/ipc'

const sourceLabel: Record<Profile['source'], string> = { preset: 'preset', global: 'global', project: 'projeto' }

export function ProfilePicker({ onPick, onClose }: { onPick: (p: Profile) => void; onClose: () => void }) {
  const profiles = useProject((s) => s.profiles)
  const trusted = useProject((s) => s.trusted)
  return (
    <div className="absolute right-2 top-9 z-50 w-64 rounded border border-zinc-700 bg-zinc-900 p-1 shadow-xl" onMouseLeave={onClose}>
      {profiles.length === 0 && <div className="px-2 py-1 text-xs text-zinc-500">nenhum perfil</div>}
      {profiles.map((p) => {
        const locked = p.source === 'project' && !trusted
        return (
          <button key={p.id} onClick={() => onPick(p)}
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-zinc-800">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color ?? '#6e7681' }} />
            <span className="flex-1 truncate">{p.name}</span>
            {locked && <span className="text-[10px] text-amber-400">🔒</span>}
            <span className="text-[10px] text-zinc-500">{sourceLabel[p.source]}</span>
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Replace `src/renderer/ui/Toolbar.tsx`**

```tsx
import { useState } from 'react'
import { useGrid } from '../store/gridStore'
import { ProfilePicker } from './ProfilePicker'
import type { LayoutKind } from '@shared/types'
import type { Profile } from '@shared/ipc'

const layouts: { key: LayoutKind; label: string }[] = [
  { key: 'two', label: '2' }, { key: 'three', label: '3' }, { key: 'quad', label: '2x2' },
]

export function Toolbar({ onPickProfile }: { onPickProfile: (p: Profile) => void }) {
  const active = useGrid((s) => s.activeLayout)
  const setLayout = useGrid((s) => s.setLayout)
  const [open, setOpen] = useState(false)
  return (
    <div className="relative flex items-center gap-2 border-b border-zinc-800 px-3 py-1.5">
      <span className="text-xs text-zinc-400">Layout</span>
      {layouts.map((l) => (
        <button key={l.key} onClick={() => setLayout(l.key)}
          className={`rounded px-2 py-0.5 text-xs ${active === l.key ? 'bg-sky-600 text-white' : 'bg-zinc-800 text-zinc-300'}`}>{l.label}</button>
      ))}
      <button onClick={() => setOpen((v) => !v)} className="ml-auto rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-200">+ terminal</button>
      {open && <ProfilePicker onPick={(p) => { setOpen(false); onPickProfile(p) }} onClose={() => setOpen(false)} />}
    </div>
  )
}
```

- [ ] **Step 3: Replace `src/renderer/ui/Sidebar.tsx` (add color dot)**

```tsx
import { useGrid } from '../store/gridStore'

export function Sidebar() {
  const panes = useGrid((s) => s.panes)
  const active = useGrid((s) => s.activePaneId)
  const setActive = useGrid((s) => s.setActive)
  const removePane = useGrid((s) => s.removePane)
  return (
    <aside className="w-56 shrink-0 border-r border-zinc-800 p-2 text-sm">
      <div className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Terminais</div>
      {panes.length === 0 && <div className="text-xs text-zinc-600">nenhum terminal</div>}
      {panes.map((p) => (
        <div key={p.id} onClick={() => setActive(p.id)}
          className={`flex items-center gap-2 rounded px-2 py-1 ${active === p.id ? 'bg-zinc-800' : ''}`}>
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color ?? '#6e7681' }} />
          <span className="flex-1 truncate">{p.name}</span>
          <button onClick={(e) => { e.stopPropagation(); removePane(p.id); void window.term.invoke('pty:kill', { id: p.id }) }}
            className="text-zinc-500 hover:text-red-400">×</button>
        </div>
      ))}
    </aside>
  )
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: 0 (App.tsx will break because Toolbar prop changed from `onNewTerminal` to `onPickProfile` — Task 12 fixes App. If you run typecheck now it errors in App.tsx; that's expected and fixed in Task 12. To keep commits green, do Steps 1-3 here and commit after Task 12, OR temporarily keep `onNewTerminal` too. SIMPLEST: implement App wiring (Task 12) before committing Toolbar. Mark this task's commit as deferred — see Task 12 Step for combined commit.)

NOTE: To keep each commit compiling, COMBINE the commit of Tasks 10, 11, 12 (UI wiring) — implement all three, then typecheck + commit once. The steps below for Tasks 11/12 say the same.

---

## Task 11: ProjectBar + RestrictedBanner + MaestroProblems + GlobalProfiles

**Files:** Create `src/renderer/ui/ProjectBar.tsx`, `RestrictedBanner.tsx`, `MaestroProblems.tsx`, `GlobalProfiles.tsx`

- [ ] **Step 1: Create `src/renderer/ui/ProjectBar.tsx`**

```tsx
import { useState } from 'react'
import { useProject } from '../store/projectStore'
import { basename } from '../util/basename'

export function ProjectBar() {
  const current = useProject((s) => s.currentProject)
  const recent = useProject((s) => s.recentProjects)
  const apply = useProject((s) => s.apply)
  const [open, setOpen] = useState(false)

  async function openDialog() {
    const s = await window.term.invoke('project:open', undefined)
    if (s) apply(s); setOpen(false)
  }
  async function openPath(p: string) {
    const s = await window.term.invoke('project:openPath', { path: p })
    apply(s); setOpen(false)
  }

  return (
    <div className="relative flex items-center gap-2 border-b border-zinc-800 bg-zinc-950 px-3 py-1">
      <button onClick={() => setOpen((v) => !v)} className="rounded px-2 py-0.5 text-xs text-zinc-200 hover:bg-zinc-800">
        {current ? basename(current) : 'Abrir projeto'} ▾
      </button>
      {open && (
        <div className="absolute left-2 top-7 z-50 w-72 rounded border border-zinc-700 bg-zinc-900 p-1 shadow-xl" onMouseLeave={() => setOpen(false)}>
          <button onClick={openDialog} className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-zinc-800">Abrir pasta…</button>
          {recent.length > 0 && <div className="mt-1 border-t border-zinc-800 px-2 py-1 text-[10px] uppercase text-zinc-600">Recentes</div>}
          {recent.map((p) => (
            <button key={p} onClick={() => openPath(p)} className="block w-full truncate rounded px-2 py-1 text-left text-xs text-zinc-300 hover:bg-zinc-800" title={p}>{basename(p)}</button>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create `src/renderer/util/basename.ts`**

```ts
export function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}
```

- [ ] **Step 3: Create `src/renderer/ui/RestrictedBanner.tsx`**

```tsx
import { useProject } from '../store/projectStore'

export function RestrictedBanner() {
  const current = useProject((s) => s.currentProject)
  const trusted = useProject((s) => s.trusted)
  const profiles = useProject((s) => s.profiles)
  const apply = useProject((s) => s.apply)
  const hasProject = profiles.some((p) => p.source === 'project')
  if (!current || trusted || !hasProject) return null

  async function grant(parent: boolean) {
    const ch = parent ? 'trust:grantParent' : 'trust:grant'
    const s = await window.term.invoke(ch, { path: current! })
    apply(s)
  }
  return (
    <div className="flex items-center gap-2 border-b border-amber-700/40 bg-amber-950/40 px-3 py-1.5 text-xs text-amber-200">
      <span className="flex-1">Modo Restrito — este projeto define perfis que executam programas. Confie na pasta para habilitá-los.</span>
      <button onClick={() => grant(false)} className="rounded bg-amber-600 px-2 py-0.5 text-white">Confiar</button>
      <button onClick={() => grant(true)} className="rounded bg-amber-800/60 px-2 py-0.5">Confiar na pasta-pai</button>
    </div>
  )
}
```

- [ ] **Step 4: Create `src/renderer/ui/MaestroProblems.tsx`**

```tsx
import { useProject } from '../store/projectStore'

export function MaestroProblems() {
  const problems = useProject((s) => s.problems)
  const current = useProject((s) => s.currentProject)
  const hasFile = useProject((s) => s.hasMaestroFile)
  const apply = useProject((s) => s.apply)
  if (!current) return null

  async function scaffold() {
    const s = await window.term.invoke('maestro:scaffold', { path: current! })
    apply(s)
  }
  if (!hasFile) {
    return <div className="border-b border-zinc-800 px-3 py-1 text-xs text-zinc-400">Sem <code>maestro.yml</code> neste projeto. <button onClick={scaffold} className="text-sky-400 underline">criar</button></div>
  }
  if (problems.length === 0) return null
  return (
    <div className="border-b border-red-800/40 bg-red-950/30 px-3 py-1.5 text-xs text-red-200">
      <div className="font-semibold">maestro.yml inválido:</div>
      {problems.map((p, i) => (
        <div key={i} className="font-mono">
          {p.kind === 'syntax' ? `linha ${p.line}:${p.col} — ${p.message}` : `${p.path}: ${p.message}`}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 5: Create `src/renderer/ui/GlobalProfiles.tsx`**

```tsx
import { useState } from 'react'
import { useProject } from '../store/projectStore'
import type { ProfileEntry } from '@shared/ipc'

export function GlobalProfiles({ onClose }: { onClose: () => void }) {
  const apply = useProject((s) => s.apply)
  const globals = useProject((s) => s.profiles.filter((p) => p.source === 'global'))
  const [id, setId] = useState(''); const [command, setCommand] = useState('')

  async function save() {
    if (!id.trim() || !command.trim()) return
    const cur: Record<string, ProfileEntry> = {}
    for (const g of globals) cur[g.id] = { command: g.command, args: g.args, color: g.color }
    cur[id.trim()] = { command: command.trim(), args: [] }
    const s = await window.term.invoke('profiles:setGlobal', { profiles: cur })
    apply(s); setId(''); setCommand('')
  }
  async function remove(rid: string) {
    const cur: Record<string, ProfileEntry> = {}
    for (const g of globals) if (g.id !== rid) cur[g.id] = { command: g.command, args: g.args, color: g.color }
    const s = await window.term.invoke('profiles:setGlobal', { profiles: cur })
    apply(s)
  }
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-96 rounded border border-zinc-700 bg-zinc-900 p-4 text-sm" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 font-semibold">Perfis globais</div>
        {globals.length === 0 && <div className="mb-2 text-xs text-zinc-500">nenhum perfil global</div>}
        {globals.map((g) => (
          <div key={g.id} className="flex items-center gap-2 py-0.5">
            <span className="flex-1">{g.name} <span className="text-zinc-500">({g.command})</span></span>
            <button onClick={() => remove(g.id)} className="text-zinc-500 hover:text-red-400">remover</button>
          </div>
        ))}
        <div className="mt-2 flex gap-1">
          <input value={id} onChange={(e) => setId(e.target.value)} placeholder="id" className="w-24 rounded bg-zinc-800 px-1 py-0.5" />
          <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="command" className="flex-1 rounded bg-zinc-800 px-1 py-0.5" />
          <button onClick={save} className="rounded bg-sky-600 px-2 text-white">add</button>
        </div>
        <button onClick={onClose} className="mt-3 text-xs text-zinc-400">fechar</button>
      </div>
    </div>
  )
}
```

(Combined commit happens in Task 12.)

---

## Task 12: Wire App (project hydrate, picker, autoStart, trust) + combined UI commit

**Files:** Modify `src/renderer/App.tsx`

- [ ] **Step 1: Replace `src/renderer/App.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import { Sidebar } from './ui/Sidebar'
import { Toolbar } from './ui/Toolbar'
import { ProjectBar } from './ui/ProjectBar'
import { RestrictedBanner } from './ui/RestrictedBanner'
import { MaestroProblems } from './ui/MaestroProblems'
import { GlobalProfiles } from './ui/GlobalProfiles'
import { Grid } from './grid/Grid'
import { useGrid } from './store/gridStore'
import { useProject } from './store/projectStore'
import { hydrateLayoutSizes } from './grid/layoutStorage'
import type { AppConfig, PaneConfig } from '@shared/types'
import type { Profile, ProjectState } from '@shared/ipc'

function uuid(): string { return crypto.randomUUID() }

export function App() {
  const panes = useGrid((s) => s.panes)
  const addPane = useGrid((s) => s.addPane)
  const setLayout = useGrid((s) => s.setLayout)
  const hydrated = useRef(false)
  const project = useProject()
  const autoStarted = useRef<Set<string>>(new Set())
  const [showGlobals, setShowGlobals] = useState(false)

  // hydrate panes + project
  useEffect(() => {
    void (async () => {
      await hydrateLayoutSizes()
      const cfg: AppConfig = await window.term.invoke('config:get', undefined)
      setLayout(cfg.activeLayout)
      cfg.panes.forEach(addPane)
      await useProject.getState().hydrate()
      hydrated.current = true
    })()
    const off = window.term.on('project:changed', (s: ProjectState) => useProject.getState().apply(s))
    return off
  }, [addPane, setLayout])

  useEffect(() => {
    if (!hydrated.current) return
    void window.term.invoke('config:set', { patch: { panes, activeLayout: useGrid.getState().activeLayout } })
  }, [panes])

  function paneFromProfile(p: Profile): PaneConfig {
    const isProject = p.source === 'project'
    return {
      id: uuid(), name: p.name, command: p.command, args: p.args,
      cwd: p.cwd ?? project.currentProject ?? '.',
      env: p.env, color: p.color, profileId: p.id,
      origin: isProject ? 'project' : 'user',
      projectRoot: project.currentProject ?? undefined,
    }
  }
  function pickProfile(p: Profile) { addPane(paneFromProfile(p)) }

  // autoStart project profiles once, when trusted
  useEffect(() => {
    if (!project.trusted || !project.currentProject) return
    for (const p of project.profiles) {
      if (p.source === 'project' && p.autoStart && !autoStarted.current.has(p.id)) {
        autoStarted.current.add(p.id)
        addPane(paneFromProfile(p))
      }
    }
  }, [project.trusted, project.currentProject, project.profiles])

  return (
    <div className="flex h-full w-full flex-col">
      <ProjectBar />
      <MaestroProblems />
      <RestrictedBanner />
      <Toolbar onPickProfile={pickProfile} />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1"><Grid /></main>
      </div>
      <button onClick={() => setShowGlobals(true)} className="absolute bottom-2 left-2 z-40 rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">perfis globais</button>
      {showGlobals && <GlobalProfiles onClose={() => setShowGlobals(false)} />}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors across Tasks 10-12 files.

- [ ] **Step 3: Tests**

Run: `npm run test:unit && npm run test:component`
Expected: unit green; component (TerminalPane) green.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: builds clean.

- [ ] **Step 5: Commit (combined UI)**

```bash
git add src/renderer
git commit -m "feat: project bar, profile picker, restricted banner, problems, global profiles, autoStart"
```

---

## Task 13: E2E — project open + trust + profile spawn

**Files:** Create `e2e/fixtures/sample/maestro.yml`; Create `e2e/profiles.spec.ts`

- [ ] **Step 1: Create `e2e/fixtures/sample/maestro.yml`**

```yaml
version: 1
defaultProfile: shell
profiles:
  echoer:
    name: Echoer
    command: powershell.exe
    args: []
    color: "#3fb950"
```
NOTE: on Linux/mac CI this fixture spawns powershell.exe which may be absent; the E2E asserts trust flow + pane creation, and types into a profile terminal. To stay cross-platform, the test will pick the built-in `shell` preset (always valid) rather than the project `echoer` for the echo assertion, and use the project profile only to assert the trust gate. Keep fixture as-is.

- [ ] **Step 2: Create `e2e/profiles.spec.ts`**

```ts
import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, mkdirSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('abre projeto, modo restrito, confia, perfil shell roda', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'maestro-e2e-'))
  // monta um projeto temporário com maestro.yml
  const proj = mkdtempSync(join(tmpdir(), 'maestro-proj-'))
  copyFileSync(join(process.cwd(), 'e2e/fixtures/sample/maestro.yml'), join(proj, 'maestro.yml'))

  const app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`] })
  // stub do diálogo de pasta para retornar o projeto temporário
  await app.evaluate(async ({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
  }, proj)
  const win = await app.firstWindow()
  await win.waitForSelector('text=Layout', { timeout: 20000 })

  // abre projeto
  await win.getByRole('button', { name: 'Abrir projeto ▾' }).click()
  await win.getByRole('button', { name: 'Abrir pasta…' }).click()

  // modo restrito aparece (projeto define perfil que executa)
  await expect(win.getByText(/Modo Restrito/)).toBeVisible({ timeout: 10000 })
  // confia
  await win.getByRole('button', { name: 'Confiar', exact: true }).click()
  await expect(win.getByText(/Modo Restrito/)).toHaveCount(0)

  // abre um terminal via picker (preset shell, sempre válido)
  await win.getByRole('button', { name: '+ terminal' }).click()
  await win.getByRole('button', { name: /shell/ }).first().click()
  await expect(win.locator('.xterm-screen')).toHaveCount(1)
  const term = win.locator('.xterm-screen').first()
  await term.click()
  await expect(win.locator('.xterm-rows')).toContainText(/\$|>|PS /, { timeout: 20000 })
  await win.keyboard.type('echo MAESTROOK\r')
  await expect(win.locator('.xterm-rows')).toContainText('MAESTROOK', { timeout: 20000 })
  await app.close()
})
```

- [ ] **Step 3: Build + run E2E**

Run: `npm run build && npm run test:e2e`
Expected: PASS (both e2e specs — terminal.spec.ts from #1 and profiles.spec.ts). On a dev machine without the AI CLIs, the test only spawns the `shell` preset, so it passes. If `powershell.exe` profile in the fixture matters, it doesn't for the assertions.

- [ ] **Step 4: Commit**

```bash
git add e2e
git commit -m "test: e2e project open + workspace trust + profile shell spawn"
```

---

## Task 14: Final verification

- [ ] **Step 1: Full suite**

Run: `npm run typecheck && npm run test:unit && npm run test:component && npm run build`
Expected: typecheck 0; all unit green; component green; build clean.

- [ ] **Step 2: Run E2E**

Run: `npm run test:e2e`
Expected: both specs pass.

- [ ] **Step 3: Confirm git clean**

Run: `git status --porcelain` → empty.

---

## Self-Review (preenchido)

**Cobertura da spec:**
- §3.1 Profile / §3.2 presets → T1, T2, T5. §3.3 maestro.yml schema → T2, T4. §3.4 AppConfig v2 → T2, T6. §3.5 PaneConfig → T2, T9. ✔
- §4.1 maestroConfig → T4. §4.2 watcher → T7. §4.3 trust → T3. §4.4 projectManager → T7. §4.5 ConfigStore → T6. §4.6 ipcRouter+gate → T8. §4.7 renderer → T9-T12. ✔
- §5 fluxos → T8 (gate), T12 (hydrate/autoStart/trust). §6 erros → T4 (problems), T9 (TRUST_REQUIRED), T6 (migrate), T7 (absent). §7 testes → T3/T4/T5/T6/T7 (unit), T13 (e2e). ✔
- Workspace trust hardening (realpath canonical, segment containment, origin/projectRoot refine, main-side gate) → T3 + T2 (refine) + T8 (gate). ✔

**Placeholder scan:** sem TBD/TODO; todo passo de código tem código completo.

**Consistência de tipos:** `Profile`/`ProfileEntry`/`ProjectState`/`AppConfig v2` (T2) usados igual em T5/T6/T7/T9-T12. Canais novos (T2 ipc) batem com handlers (T8). `mergeProfiles(presets,global,project)` (T5) chamado igual em projectManager (T7). `ProjectState` shape idêntico entre ipc.ts (T2), projectManager.state() (T7), projectStore (T9). `pty:create` payload com origin/projectRoot consistente: schema refine (T2) ↔ handler gate (T8) ↔ TerminalPane invoke (T9) ↔ paneFromProfile (T12). ✔

**Nota de commit:** Tasks 10-11 não compilam isoladas (App ainda usa API antiga do Toolbar); por isso o commit das UIs é único no fim da Task 12 (já indicado nos passos). Cada commit resultante compila.
