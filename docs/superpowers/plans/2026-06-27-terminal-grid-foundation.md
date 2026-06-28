# Terminal Grid Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir a fundação do HiveTerm clone: uma janela Electron que roda N terminais reais (PTY) em um grid redimensionável (presets 2/3/2×2), cada pane rodando uma CLI arbitrária, com layouts e terminais persistidos e baseline de segurança Electron 2026.

**Architecture:** Electron com 3 contextos: `main` (lifecycle, IPC router, electron-store), `utilityProcess` PtyHost (node-pty vive aqui), e `renderer` React sandboxed (xterm + react-resizable-panels + zustand). Renderer fala só via contextBridge tipado. Streams de PTY isolados por canal `pty:data:<id>`.

**Tech Stack:** electron 42, electron-vite 5 (+Vite 7, plugin-react 5.2.0), electron-builder 26, node-pty 1.1, @xterm/* 6, react-resizable-panels 4, zustand 5, electron-store 11, zod 4, tailwindcss 4, vitest 4 (+Browser Mode), @playwright/test.

**Spec:** `docs/superpowers/specs/2026-06-27-terminal-grid-foundation-design.md`

---

## File Structure

```
/                       package.json, electron.vite.config.ts, electron-builder.yml,
                        tsconfig.json, tsconfig.node.json, vitest.config.ts,
                        playwright.config.ts, .gitignore
/src/main/             index.ts            — app lifecycle, janela, CSP, quit cleanup
                       ipcRouter.ts        — ipcMain.handle tipado + sender/zod validation
                       configStore.ts      — electron-store wrapper (fonte da verdade)
                       ptyHostBridge.ts    — spawna utilityProcess, faz ponte main<->PtyHost
/src/main/pty/         ptyManager.ts       — node-pty lifecycle (roda no utilityProcess)
                       resolveLauncher.ts  — resolução cross-platform de comando (.cmd no Win)
                       ptyHostEntry.ts     — entrypoint do utilityProcess (usa ptyManager)
/src/preload/          index.ts            — contextBridge -> window.term
/src/shared/           ipc.ts              — nomes de canal + tipos request/response/eventos
                       schemas.ts          — zod schemas dos payloads
                       types.ts            — PaneConfig, LayoutKind, AppConfig, etc.
/src/renderer/         main.tsx, App.tsx, index.css
/src/renderer/store/   gridStore.ts        — zustand: layout ativo, panes, activePane
/src/renderer/grid/    Grid.tsx, TwoPane.tsx, ThreePane.tsx, QuadPane.tsx, layoutStorage.ts
/src/renderer/term/    TerminalPane.tsx, webglPool.ts, xtermTheme.ts
/src/renderer/ui/      Sidebar.tsx, Toolbar.tsx
/e2e/                  terminal.spec.ts
```

---

## Task 1: Scaffold do projeto (electron-vite + React + TS + Tailwind)

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `electron.vite.config.ts`, `.gitignore` (já existe — ajustar)

- [ ] **Step 1: Criar `package.json`**

```json
{
  "name": "hiveterm-clone",
  "version": "0.1.0",
  "description": "Desktop app para orquestrar CLIs de IA em grid de terminais",
  "main": "out/main/index.js",
  "type": "module",
  "scripts": {
    "postinstall": "electron-rebuild -f -w node-pty",
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "package": "electron-vite build && electron-builder",
    "typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json",
    "test:unit": "vitest run --project unit",
    "test:component": "vitest run --project pane",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@xterm/addon-fit": "^0.11.0",
    "@xterm/addon-search": "^0.16.0",
    "@xterm/addon-serialize": "^0.14.0",
    "@xterm/addon-unicode11": "^0.9.0",
    "@xterm/addon-web-links": "^0.12.0",
    "@xterm/addon-webgl": "^0.19.0",
    "@xterm/xterm": "^6.0.0",
    "electron-store": "^11.0.2",
    "node-pty": "^1.1.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "react-resizable-panels": "^4.11.2",
    "which": "^7.0.0",
    "zod": "^4.0.0",
    "zustand": "^5.0.0"
  },
  "devDependencies": {
    "@electron/rebuild": "^4.0.5",
    "@playwright/test": "^1.61.0",
    "@tailwindcss/vite": "^4.3.1",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@types/which": "^3.0.4",
    "@vitejs/plugin-react": "5.2.0",
    "@vitest/browser-playwright": "^4.1.0",
    "electron": "^42.5.0",
    "electron-builder": "^26.15.6",
    "electron-vite": "^5.0.0",
    "tailwindcss": "^4.3.1",
    "typescript": "^5.6.0",
    "vite": "^7.3.6",
    "vitest": "^4.1.0",
    "vitest-browser-react": "^2.2.0"
  }
}
```

- [ ] **Step 2: Criar `tsconfig.json` (renderer/shared) e `tsconfig.node.json` (main/preload)**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "jsx": "react-jsx",
    "skipLibCheck": true,
    "types": ["node"],
    "baseUrl": ".",
    "paths": { "@shared/*": ["src/shared/*"] }
  },
  "include": ["src/renderer", "src/shared", "src/preload"]
}
```

`tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "types": ["node"],
    "baseUrl": ".",
    "paths": { "@shared/*": ["src/shared/*"] }
  },
  "include": ["src/main", "src/shared"]
}
```

- [ ] **Step 3: Criar `electron.vite.config.ts`**

```ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

const alias = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: { alias },
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          ptyHostEntry: resolve('src/main/pty/ptyHostEntry.ts'),
        },
      },
    },
  },
  preload: {
    resolve: { alias },
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { output: { format: 'cjs' } } },
  },
  renderer: {
    resolve: { alias },
    plugins: [react(), tailwindcss()],
  },
})
```

- [ ] **Step 4: Instalar dependências e rebuild nativo**

Run: `npm install`
Expected: instala sem erro; `postinstall` roda `electron-rebuild` em node-pty. No Linux exige `python3 + make + g++`; se faltar, instalar toolchain antes.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json tsconfig.node.json electron.vite.config.ts package-lock.json
git commit -m "chore: scaffold electron-vite + react + ts + tailwind"
```

---

## Task 2: Contrato compartilhado (`src/shared`)

Define tipos e canais usados por TODAS as tasks seguintes. Sem isso, nada compila com tipos.

**Files:**
- Create: `src/shared/types.ts`, `src/shared/ipc.ts`, `src/shared/schemas.ts`
- Test: `src/shared/schemas.test.ts`

- [ ] **Step 1: Criar `src/shared/types.ts`**

```ts
export type LayoutKind = 'two' | 'three' | 'quad'

export interface PaneConfig {
  id: string            // terminalId (uuid)
  name: string          // label exibido
  command: string       // ex: 'claude', 'codex', 'bash'
  args?: string[]
  cwd: string
  env?: Record<string, string>
}

export interface AppConfig {
  schemaVersion: number
  activeLayout: LayoutKind
  panes: PaneConfig[]                       // terminais abertos
  layoutSizes: Record<string, number[]>     // groupId -> sizes (%)
  settings: {
    fontFamily: string
    fontSize: number
    scrollback: number
    theme: 'system' | 'light' | 'dark'
  }
}

export const DEFAULT_CONFIG: AppConfig = {
  schemaVersion: 1,
  activeLayout: 'two',
  panes: [],
  layoutSizes: {},
  settings: { fontFamily: 'JetBrains Mono, monospace', fontSize: 13, scrollback: 5000, theme: 'system' },
}
```

- [ ] **Step 2: Criar `src/shared/ipc.ts`**

```ts
import type { AppConfig, PaneConfig } from './types'

/** request/response channels: invoke(channel, args) -> result */
export interface IpcRequest {
  'pty:create': { args: { id: string; command: string; args?: string[]; cwd: string; env?: Record<string,string>; cols: number; rows: number }; result: void }
  'pty:write':  { args: { id: string; data: string }; result: void }
  'pty:resize': { args: { id: string; cols: number; rows: number }; result: void }
  'pty:kill':   { args: { id: string }; result: void }
  'config:get': { args: undefined; result: AppConfig }
  'config:set': { args: { patch: Partial<AppConfig> }; result: void }
  'scrollback:save': { args: { id: string; data: string }; result: void }
  'scrollback:load': { args: { id: string }; result: string | null }
  'shell:openExternal': { args: { url: string }; result: void }
}
export type IpcChannel = keyof IpcRequest

/** push channels: main -> renderer. pty:data/pty:exit são namespaced por id no nome do canal */
export interface IpcEventPayloads {
  'pty:data': { data: string }
  'pty:exit': { code: number; reason?: string }
}
export const ptyDataChannel = (id: string) => `pty:data:${id}` as const
export const ptyExitChannel = (id: string) => `pty:exit:${id}` as const

export type { AppConfig, PaneConfig }
```

- [ ] **Step 3: Criar `src/shared/schemas.ts` (zod, valida payloads no main)**

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
})
export const ptyWrite = z.object({ id: z.string().min(1), data: z.string() })
export const ptyResize = z.object({ id: z.string().min(1), cols: z.number().int().positive(), rows: z.number().int().positive() })
export const ptyKill = z.object({ id: z.string().min(1) })
export const configSet = z.object({ patch: z.record(z.string(), z.unknown()) })
export const scrollbackSave = z.object({ id: z.string().min(1), data: z.string() })
export const scrollbackLoad = z.object({ id: z.string().min(1) })
export const shellOpen = z.object({ url: z.string().url() })

export const schemaByChannel = {
  'pty:create': ptyCreate,
  'pty:write': ptyWrite,
  'pty:resize': ptyResize,
  'pty:kill': ptyKill,
  'config:set': configSet,
  'scrollback:save': scrollbackSave,
  'scrollback:load': scrollbackLoad,
  'shell:openExternal': shellOpen,
} as const
```

- [ ] **Step 4: Escrever teste falhando `src/shared/schemas.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { ptyCreate, shellOpen } from './schemas'

describe('schemas', () => {
  it('aceita payload pty:create válido', () => {
    expect(ptyCreate.safeParse({ id: 'a', command: 'bash', cwd: '/tmp', cols: 80, rows: 24 }).success).toBe(true)
  })
  it('rejeita cols não positivo', () => {
    expect(ptyCreate.safeParse({ id: 'a', command: 'bash', cwd: '/tmp', cols: 0, rows: 24 }).success).toBe(false)
  })
  it('rejeita url inválida em shell:openExternal', () => {
    expect(shellOpen.safeParse({ url: 'not a url' }).success).toBe(false)
  })
})
```

- [ ] **Step 5: Rodar teste (deve falhar antes da config do vitest existir; criar config mínima primeiro se necessário)**

Run: `npx vitest run src/shared/schemas.test.ts`
Expected: PASS depois que `vitest.config.ts` da Task 9 existir; se rodar antes, criar config mínima `import {defineConfig} from 'vitest/config'; export default defineConfig({})`. Como a Task 9 formaliza, aqui valide com config default.

- [ ] **Step 6: Commit**

```bash
git add src/shared
git commit -m "feat: shared ipc contract, types e zod schemas"
```

---

## Task 3: `resolveLauncher` (resolução cross-platform de comando)

Resolve o problema #1 do Windows: spawnar `claude`/`codex` (que são `.cmd` + shim sem extensão). TDD primeiro.

**Files:**
- Create: `src/main/pty/resolveLauncher.ts`
- Test: `src/main/pty/resolveLauncher.test.ts`

- [ ] **Step 1: Escrever teste falhando**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('which', () => ({ default: { sync: vi.fn() } }))
import which from 'which'
import { resolveLauncher } from './resolveLauncher'

const whichSync = (which as unknown as { sync: ReturnType<typeof vi.fn> }).sync

beforeEach(() => whichSync.mockReset())

describe('resolveLauncher (win32)', () => {
  it('prefere o .cmd e roda via cmd.exe /c', () => {
    whichSync.mockReturnValue(['C:\\bin\\claude', 'C:\\bin\\claude.cmd'])
    const r = resolveLauncher('claude', ['--help'], 'win32', { ComSpec: 'C:\\Windows\\System32\\cmd.exe' })
    expect(r.file.toLowerCase()).toContain('cmd.exe')
    expect(r.args).toEqual(['/d', '/s', '/c', 'C:\\bin\\claude.cmd', '--help'])
  })
  it('nunca escolhe o shim sem extensão', () => {
    whichSync.mockReturnValue(['C:\\bin\\claude'])
    const r = resolveLauncher('claude', [], 'win32', { ComSpec: 'cmd.exe' })
    expect(r.args).toContain('C:\\bin\\claude.cmd') // fallback para <bin>.cmd
  })
})

describe('resolveLauncher (posix)', () => {
  it('roda via login shell -lc', () => {
    const r = resolveLauncher('claude', ['x'], 'linux', { SHELL: '/bin/zsh' })
    expect(r.file).toBe('/bin/zsh')
    expect(r.args).toEqual(['-lc', 'claude x'])
  })
})
```

- [ ] **Step 2: Rodar teste pra ver falhar**

Run: `npx vitest run src/main/pty/resolveLauncher.test.ts`
Expected: FAIL — `resolveLauncher is not a function`.

- [ ] **Step 3: Implementar `src/main/pty/resolveLauncher.ts`**

```ts
import which from 'which'

export interface Launcher { file: string; args: string[] }

export function resolveLauncher(
  command: string,
  args: string[] = [],
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): Launcher {
  if (platform === 'win32') {
    const found = (which.sync(command, { all: true, nothrow: true }) as string[] | null) ?? []
    const cmd = found.find((p) => p.toLowerCase().endsWith('.cmd'))
      ?? found.find((p) => p.toLowerCase().endsWith('.exe'))
      ?? `${command}.cmd`
    const comspec = env.ComSpec ?? 'cmd.exe'
    return { file: comspec, args: ['/d', '/s', '/c', cmd, ...args] }
  }
  const shell = env.SHELL ?? '/bin/bash'
  const line = [command, ...args].join(' ')
  return { file: shell, args: ['-lc', line] }
}
```

- [ ] **Step 4: Rodar teste pra ver passar**

Run: `npx vitest run src/main/pty/resolveLauncher.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/main/pty/resolveLauncher.ts src/main/pty/resolveLauncher.test.ts
git commit -m "feat: resolveLauncher cross-platform (.cmd via cmd.exe no win)"
```

---

## Task 4: `PtyManager` (node-pty lifecycle, roda no utilityProcess)

Lógica pura de gerência de PTYs com node-pty mockado. É o coração do PtyHost.

**Files:**
- Create: `src/main/pty/ptyManager.ts`
- Test: `src/main/pty/ptyManager.test.ts`

- [ ] **Step 1: Escrever teste falhando**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

const spawn = vi.fn()
vi.mock('node-pty', () => ({ spawn }))
vi.mock('./resolveLauncher', () => ({
  resolveLauncher: (cmd: string, args: string[]) => ({ file: cmd, args }),
}))
import { PtyManager } from './ptyManager'

function fakePty() {
  const ee = new EventEmitter()
  return Object.assign(ee, {
    onData: (cb: (d: string) => void) => ee.on('data', cb),
    onExit: (cb: (e: { exitCode: number }) => void) => ee.on('exit', cb),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
  })
}

beforeEach(() => spawn.mockReset())

describe('PtyManager', () => {
  it('spawna e encaminha data via sink por id', () => {
    const p = fakePty(); spawn.mockReturnValue(p)
    const onData = vi.fn(); const onExit = vi.fn()
    const mgr = new PtyManager({ onData, onExit })
    mgr.spawn({ id: 't1', command: 'bash', cwd: '/tmp', cols: 80, rows: 24 })
    expect(spawn).toHaveBeenCalledWith('bash', [], expect.objectContaining({ cols: 80, rows: 24 }))
    ;(p as unknown as EventEmitter).emit('data', 'hi')
    expect(onData).toHaveBeenCalledWith('t1', 'hi')
  })

  it('encaminha write/resize/kill ao pty certo', () => {
    const p = fakePty(); spawn.mockReturnValue(p)
    const mgr = new PtyManager({ onData: vi.fn(), onExit: vi.fn() })
    mgr.spawn({ id: 't1', command: 'bash', cwd: '/tmp', cols: 80, rows: 24 })
    mgr.write('t1', 'ls')
    mgr.resize('t1', 100, 40)
    mgr.kill('t1')
    expect(p.write).toHaveBeenCalledWith('ls')
    expect(p.resize).toHaveBeenCalledWith(100, 40)
    expect(p.kill).toHaveBeenCalled()
  })

  it('emite exit e remove o pty do mapa', () => {
    const p = fakePty(); spawn.mockReturnValue(p)
    const onExit = vi.fn()
    const mgr = new PtyManager({ onData: vi.fn(), onExit })
    mgr.spawn({ id: 't1', command: 'bash', cwd: '/tmp', cols: 80, rows: 24 })
    ;(p as unknown as EventEmitter).emit('exit', { exitCode: 0 })
    expect(onExit).toHaveBeenCalledWith('t1', 0, undefined)
    mgr.write('t1', 'x') // não deve lançar
  })

  it('emite exit com motivo quando spawn lança', () => {
    spawn.mockImplementation(() => { throw new Error('spawn ENOENT') })
    const onExit = vi.fn()
    const mgr = new PtyManager({ onData: vi.fn(), onExit })
    mgr.spawn({ id: 't1', command: 'nope', cwd: '/tmp', cols: 80, rows: 24 })
    expect(onExit).toHaveBeenCalledWith('t1', 1, expect.stringContaining('ENOENT'))
  })

  it('killAll mata todos', () => {
    const a = fakePty(); const b = fakePty()
    spawn.mockReturnValueOnce(a).mockReturnValueOnce(b)
    const mgr = new PtyManager({ onData: vi.fn(), onExit: vi.fn() })
    mgr.spawn({ id: 'a', command: 'bash', cwd: '/tmp', cols: 80, rows: 24 })
    mgr.spawn({ id: 'b', command: 'bash', cwd: '/tmp', cols: 80, rows: 24 })
    mgr.killAll()
    expect(a.kill).toHaveBeenCalled()
    expect(b.kill).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Rodar teste pra ver falhar**

Run: `npx vitest run src/main/pty/ptyManager.test.ts`
Expected: FAIL — `PtyManager is not a constructor`.

- [ ] **Step 3: Implementar `src/main/pty/ptyManager.ts`**

```ts
import * as pty from 'node-pty'
import { resolveLauncher } from './resolveLauncher'

export interface SpawnOpts {
  id: string; command: string; args?: string[]; cwd: string
  env?: Record<string, string>; cols: number; rows: number
}
export interface PtySinks {
  onData: (id: string, data: string) => void
  onExit: (id: string, code: number, reason?: string) => void
}

export class PtyManager {
  private ptys = new Map<string, pty.IPty>()
  constructor(private sinks: PtySinks) {}

  spawn(o: SpawnOpts): void {
    const { file, args } = resolveLauncher(o.command, o.args ?? [])
    try {
      const p = pty.spawn(file, args, {
        name: 'xterm-256color',
        cols: o.cols,
        rows: o.rows,
        cwd: o.cwd,
        env: { ...process.env, ...(o.env ?? {}) }, // manter SystemRoot/Path
        useConptyDll: true,
        handleFlowControl: true,
      })
      p.onData((d) => this.sinks.onData(o.id, d))
      p.onExit(({ exitCode }) => {
        this.ptys.delete(o.id)
        this.sinks.onExit(o.id, exitCode)
      })
      this.ptys.set(o.id, p)
    } catch (err) {
      this.sinks.onExit(o.id, 1, err instanceof Error ? err.message : String(err))
    }
  }

  write(id: string, data: string): void { this.ptys.get(id)?.write(data) }
  resize(id: string, cols: number, rows: number): void { this.ptys.get(id)?.resize(cols, rows) }
  kill(id: string): void { this.ptys.get(id)?.kill(); this.ptys.delete(id) }
  killAll(): void { for (const p of this.ptys.values()) p.kill(); this.ptys.clear() }
}
```

- [ ] **Step 4: Rodar teste pra ver passar**

Run: `npx vitest run src/main/pty/ptyManager.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add src/main/pty/ptyManager.ts src/main/pty/ptyManager.test.ts
git commit -m "feat: PtyManager (spawn/write/resize/kill, exit handling)"
```

---

## Task 5: `ConfigStore` (electron-store, fonte da verdade)

**Files:**
- Create: `src/main/configStore.ts`
- Test: `src/main/configStore.test.ts`

- [ ] **Step 1: Escrever teste falhando**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const data: Record<string, unknown> = {}
const mockStore = {
  get store() { return data },
  get: (k: string) => data[k],
  set: vi.fn((k: string, v: unknown) => { data[k] = v }),
}
vi.mock('electron-store', () => ({ default: vi.fn(() => mockStore) }))
import { ConfigStore } from './configStore'
import { DEFAULT_CONFIG } from '@shared/types'

beforeEach(() => { for (const k of Object.keys(data)) delete data[k]; mockStore.set.mockClear() })

describe('ConfigStore', () => {
  it('retorna default quando vazio', () => {
    const cs = new ConfigStore()
    expect(cs.get().activeLayout).toBe(DEFAULT_CONFIG.activeLayout)
  })
  it('faz merge de patch parcial', () => {
    const cs = new ConfigStore()
    cs.set({ activeLayout: 'quad' })
    expect(cs.get().activeLayout).toBe('quad')
    expect(cs.get().settings.scrollback).toBe(DEFAULT_CONFIG.settings.scrollback)
  })
  it('persiste panes', () => {
    const cs = new ConfigStore()
    cs.set({ panes: [{ id: 'a', name: 'A', command: 'bash', cwd: '/tmp' }] })
    expect(cs.get().panes).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Rodar teste pra ver falhar**

Run: `npx vitest run src/main/configStore.test.ts`
Expected: FAIL — `ConfigStore is not a constructor`.

- [ ] **Step 3: Implementar `src/main/configStore.ts`**

```ts
import Store from 'electron-store'
import { DEFAULT_CONFIG, type AppConfig } from '@shared/types'

const CURRENT_SCHEMA = 1

export class ConfigStore {
  private store = new Store<{ config: AppConfig }>({ name: 'hiveterm' })

  get(): AppConfig {
    const saved = this.store.get('config')
    if (!saved) return DEFAULT_CONFIG
    return this.migrate(saved)
  }

  set(patch: Partial<AppConfig>): void {
    const next: AppConfig = {
      ...this.get(),
      ...patch,
      settings: { ...this.get().settings, ...(patch.settings ?? {}) },
    }
    this.store.set('config', next)
  }

  private migrate(cfg: AppConfig): AppConfig {
    if (cfg.schemaVersion === CURRENT_SCHEMA) return cfg
    // migrações futuras aqui; por ora normaliza para o default + dados conhecidos
    return { ...DEFAULT_CONFIG, ...cfg, schemaVersion: CURRENT_SCHEMA }
  }
}
```

- [ ] **Step 4: Rodar teste pra ver passar**

Run: `npx vitest run src/main/configStore.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/main/configStore.ts src/main/configStore.test.ts
git commit -m "feat: ConfigStore (electron-store, merge + migração de schema)"
```

---

## Task 6: PtyHost (utilityProcess) + bridge no main

Liga PtyManager ao mundo: entrypoint do utilityProcess e a ponte que o main usa.

**Files:**
- Create: `src/main/pty/ptyHostEntry.ts`, `src/main/ptyHostBridge.ts`

- [ ] **Step 1: Criar `src/main/pty/ptyHostEntry.ts` (roda no utilityProcess)**

```ts
// Entrypoint do utilityProcess. Comunica com o main via process.parentPort.
import { PtyManager } from './ptyManager'

type InMsg =
  | { type: 'spawn'; o: { id: string; command: string; args?: string[]; cwd: string; env?: Record<string,string>; cols: number; rows: number } }
  | { type: 'write'; id: string; data: string }
  | { type: 'resize'; id: string; cols: number; rows: number }
  | { type: 'kill'; id: string }
  | { type: 'killAll' }

const port = process.parentPort

const mgr = new PtyManager({
  onData: (id, data) => port.postMessage({ type: 'data', id, data }),
  onExit: (id, code, reason) => port.postMessage({ type: 'exit', id, code, reason }),
})

port.on('message', (e: { data: InMsg }) => {
  const m = e.data
  switch (m.type) {
    case 'spawn': mgr.spawn(m.o); break
    case 'write': mgr.write(m.id, m.data); break
    case 'resize': mgr.resize(m.id, m.cols, m.rows); break
    case 'kill': mgr.kill(m.id); break
    case 'killAll': mgr.killAll(); break
  }
})
```

- [ ] **Step 2: Criar `src/main/ptyHostBridge.ts` (lado main)**

```ts
import { utilityProcess, type UtilityProcess, type WebContents } from 'electron'
import { join } from 'node:path'
import { ptyDataChannel, ptyExitChannel } from '@shared/ipc'

type OutMsg =
  | { type: 'data'; id: string; data: string }
  | { type: 'exit'; id: string; code: number; reason?: string }

export class PtyHostBridge {
  private proc: UtilityProcess | null = null
  constructor(private getWebContents: () => WebContents | null) {}

  start(): void {
    // ptyHostEntry.js é emitido como segundo input do main build (Task 1)
    const entry = join(__dirname, 'ptyHostEntry.js')
    this.proc = utilityProcess.fork(entry, [], { stdio: 'inherit' })
    this.proc.on('message', (m: OutMsg) => {
      const wc = this.getWebContents()
      if (!wc || wc.isDestroyed()) return
      if (m.type === 'data') wc.send(ptyDataChannel(m.id), { data: m.data })
      else wc.send(ptyExitChannel(m.id), { code: m.code, reason: m.reason })
    })
  }

  private post(msg: unknown): void { this.proc?.postMessage(msg) }
  spawn(o: unknown): void { this.post({ type: 'spawn', o }) }
  write(id: string, data: string): void { this.post({ type: 'write', id, data }) }
  resize(id: string, cols: number, rows: number): void { this.post({ type: 'resize', id, cols, rows }) }
  kill(id: string): void { this.post({ type: 'kill', id }) }
  killAll(): void { this.post({ type: 'killAll' }) }
  dispose(): void { this.killAll(); this.proc?.kill(); this.proc = null }
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (sem erros de tipo nos arquivos novos).

- [ ] **Step 4: Commit**

```bash
git add src/main/pty/ptyHostEntry.ts src/main/ptyHostBridge.ts
git commit -m "feat: PtyHost utilityProcess + bridge main (canais por-terminal)"
```

---

## Task 7: IpcRouter + main `index.ts` + preload

Junta tudo no main com validação de sender + zod, e expõe `window.term`.

**Files:**
- Create: `src/main/ipcRouter.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/window.d.ts`

- [ ] **Step 1: Criar `src/main/ipcRouter.ts`**

```ts
import { ipcMain, shell, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { schemaByChannel } from '@shared/schemas'
import type { IpcChannel, IpcRequest } from '@shared/ipc'
import { ConfigStore } from './configStore'
import { PtyHostBridge } from './ptyHostBridge'

export interface RouterDeps {
  config: ConfigStore
  ptyHost: PtyHostBridge
  isTrustedSender: (e: IpcMainInvokeEvent) => boolean
  scrollback: { save: (id: string, data: string) => void; load: (id: string) => string | null }
}

type Handler<C extends IpcChannel> =
  (args: IpcRequest[C]['args'], e: IpcMainInvokeEvent) => IpcRequest[C]['result'] | Promise<IpcRequest[C]['result']>

export function registerIpc(deps: RouterDeps): void {
  const handle = <C extends IpcChannel>(channel: C, fn: Handler<C>) => {
    ipcMain.handle(channel, (e, raw) => {
      if (!deps.isTrustedSender(e)) throw new Error('untrusted sender')
      const schema = (schemaByChannel as Record<string, { parse: (v: unknown) => unknown } | undefined>)[channel]
      const args = schema ? schema.parse(raw) : raw
      return fn(args as IpcRequest[C]['args'], e)
    })
  }

  handle('pty:create', (a) => { deps.ptyHost.spawn(a) })
  handle('pty:write', (a) => { deps.ptyHost.write(a.id, a.data) })
  handle('pty:resize', (a) => { deps.ptyHost.resize(a.id, a.cols, a.rows) })
  handle('pty:kill', (a) => { deps.ptyHost.kill(a.id) })
  handle('config:get', () => deps.config.get())
  handle('config:set', (a) => { deps.config.set(a.patch) })
  handle('scrollback:save', (a) => { deps.scrollback.save(a.id, a.data) })
  handle('scrollback:load', (a) => deps.scrollback.load(a.id))
  handle('shell:openExternal', (a) => { void shell.openExternal(a.url) })
}

/** allowlist síncrona do sender: file:// próprio (packaged) ou dev server */
export function makeSenderGuard(devUrl: string, isPackaged: boolean) {
  return (e: IpcMainInvokeEvent): boolean => {
    const url = e.senderFrame?.url
    if (!url) return false
    if (isPackaged) return url.startsWith('file://')
    return url.startsWith(devUrl) || url.startsWith('file://')
  }
}

export type { WebContents }
```

- [ ] **Step 2: Criar `src/main/index.ts`**

```ts
import { app, BrowserWindow, session } from 'electron'
import { join } from 'node:path'
import { ConfigStore } from './configStore'
import { PtyHostBridge } from './ptyHostBridge'
import { registerIpc, makeSenderGuard } from './ipcRouter'

const DEV_URL = process.env['ELECTRON_RENDERER_URL'] ?? 'http://localhost:5173'
const scrollbackMem = new Map<string, string>()

let win: BrowserWindow | null = null
const config = new ConfigStore()
const ptyHost = new PtyHostBridge(() => win?.webContents ?? null)

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
    cb({ responseHeaders: {
      ...d.responseHeaders,
      'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://localhost:5173"],
    } }),
  )
  ptyHost.start()
  registerIpc({
    config, ptyHost,
    isTrustedSender: makeSenderGuard(DEV_URL, app.isPackaged),
    scrollback: {
      save: (id, data) => scrollbackMem.set(id, data),
      load: (id) => scrollbackMem.get(id) ?? null,
    },
  })
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('before-quit', () => ptyHost.dispose())
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
```

- [ ] **Step 3: Criar `src/preload/index.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron'
import { ptyDataChannel, ptyExitChannel, type IpcChannel, type IpcRequest, type IpcEventPayloads } from '@shared/ipc'

const api = {
  invoke<C extends IpcChannel>(channel: C, args: IpcRequest[C]['args']): Promise<IpcRequest[C]['result']> {
    return ipcRenderer.invoke(channel, args) as Promise<IpcRequest[C]['result']>
  },
  onPtyData(id: string, cb: (p: IpcEventPayloads['pty:data']) => void): () => void {
    const ch = ptyDataChannel(id)
    const h = (_e: Electron.IpcRendererEvent, p: IpcEventPayloads['pty:data']) => cb(p) // strip event
    ipcRenderer.on(ch, h)
    return () => ipcRenderer.removeListener(ch, h)
  },
  onPtyExit(id: string, cb: (p: IpcEventPayloads['pty:exit']) => void): () => void {
    const ch = ptyExitChannel(id)
    const h = (_e: Electron.IpcRendererEvent, p: IpcEventPayloads['pty:exit']) => cb(p)
    ipcRenderer.on(ch, h)
    return () => ipcRenderer.removeListener(ch, h)
  },
}

contextBridge.exposeInMainWorld('term', api)
export type TermApi = typeof api
```

- [ ] **Step 4: Criar `src/renderer/window.d.ts`**

```ts
import type { TermApi } from '../preload/index'
declare global { interface Window { term: TermApi } }
export {}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/ipcRouter.ts src/main/index.ts src/preload/index.ts src/renderer/window.d.ts
git commit -m "feat: IpcRouter (sender+zod guard), main bootstrap, preload window.term"
```

---

## Task 8: Renderer — store, tema xterm, WebGL pool

**Files:**
- Create: `src/renderer/store/gridStore.ts`, `src/renderer/term/xtermTheme.ts`, `src/renderer/term/webglPool.ts`
- Test: `src/renderer/store/gridStore.test.ts`

- [ ] **Step 1: Escrever teste falhando do store**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useGrid } from './gridStore'

beforeEach(() => useGrid.setState({ activeLayout: 'two', panes: [], activePaneId: null }))

describe('gridStore', () => {
  it('adiciona pane e marca como ativo', () => {
    useGrid.getState().addPane({ id: 't1', name: 'A', command: 'bash', cwd: '/tmp' })
    expect(useGrid.getState().panes).toHaveLength(1)
    expect(useGrid.getState().activePaneId).toBe('t1')
  })
  it('remove pane', () => {
    useGrid.getState().addPane({ id: 't1', name: 'A', command: 'bash', cwd: '/tmp' })
    useGrid.getState().removePane('t1')
    expect(useGrid.getState().panes).toHaveLength(0)
  })
  it('troca layout', () => {
    useGrid.getState().setLayout('quad')
    expect(useGrid.getState().activeLayout).toBe('quad')
  })
})
```

- [ ] **Step 2: Rodar pra ver falhar**

Run: `npx vitest run src/renderer/store/gridStore.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `src/renderer/store/gridStore.ts`**

```ts
import { create } from 'zustand'
import type { LayoutKind, PaneConfig } from '@shared/types'

interface GridState {
  activeLayout: LayoutKind
  panes: PaneConfig[]
  activePaneId: string | null
  setLayout: (l: LayoutKind) => void
  addPane: (p: PaneConfig) => void
  removePane: (id: string) => void
  setActive: (id: string) => void
}

export const useGrid = create<GridState>((set) => ({
  activeLayout: 'two',
  panes: [],
  activePaneId: null,
  setLayout: (activeLayout) => set({ activeLayout }),
  addPane: (p) => set((s) => ({ panes: [...s.panes, p], activePaneId: p.id })),
  removePane: (id) => set((s) => ({
    panes: s.panes.filter((x) => x.id !== id),
    activePaneId: s.activePaneId === id ? null : s.activePaneId,
  })),
  setActive: (activePaneId) => set({ activePaneId }),
}))
```

- [ ] **Step 4: Rodar pra ver passar**

Run: `npx vitest run src/renderer/store/gridStore.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Implementar `src/renderer/term/xtermTheme.ts`**

```ts
import type { ITheme } from '@xterm/xterm'

export const darkTheme: ITheme = {
  background: '#0d1117', foreground: '#c9d1d9',
  cursor: '#58a6ff', selectionBackground: '#264f78',
  black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922',
  blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4',
  brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364',
  brightYellow: '#e3b341', brightBlue: '#79c0ff', brightMagenta: '#d2a8ff',
  brightCyan: '#56d4dd', brightWhite: '#ffffff',
}
```

- [ ] **Step 6: Implementar `src/renderer/term/webglPool.ts` (orçamento de contextos)**

```ts
// Limita quantos addons WebGL vivem ao mesmo tempo (limite ~8-16 contextos/página).
const MAX_WEBGL = 8
const active = new Set<string>()

export function canEnableWebgl(id: string): boolean {
  if (active.has(id)) return true
  if (active.size >= MAX_WEBGL) return false
  active.add(id)
  return true
}
export function releaseWebgl(id: string): void { active.delete(id) }
```

- [ ] **Step 7: Commit**

```bash
git add src/renderer/store/gridStore.ts src/renderer/store/gridStore.test.ts src/renderer/term/xtermTheme.ts src/renderer/term/webglPool.ts
git commit -m "feat: gridStore (zustand), tema xterm escuro, pool de WebGL"
```

---

## Task 9: TerminalPane (xterm ligado ao PTY) + config de testes Browser Mode

**Files:**
- Create: `src/renderer/term/TerminalPane.tsx`, `vitest.config.ts`
- Test: `src/renderer/term/TerminalPane.browser.test.tsx`

- [ ] **Step 1: Criar `vitest.config.ts` (projects: unit Node + pane Browser Mode)**

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: {
    projects: [
      { test: { name: 'unit', environment: 'node',
                include: ['src/**/*.test.ts'], exclude: ['src/**/*.browser.test.*'] } },
      { test: { name: 'pane',
                include: ['src/**/*.browser.test.tsx'],
                browser: { enabled: true, provider: playwright(), headless: true,
                           instances: [{ browser: 'chromium' }] } } },
    ],
  },
})
```

- [ ] **Step 2: Escrever teste falhando (Browser Mode)**

```tsx
import { render } from 'vitest-browser-react'
import { expect, test, vi, beforeEach } from 'vitest'
import { TerminalPane } from './TerminalPane'

beforeEach(() => {
  ;(window as unknown as { term: unknown }).term = {
    invoke: vi.fn().mockResolvedValue(undefined),
    onPtyData: (_id: string, cb: (p: { data: string }) => void) => {
      ;(window as unknown as { __emit: (d: string) => void }).__emit = (d) => cb({ data: d })
      return () => {}
    },
    onPtyExit: () => () => {},
  }
})

test('escreve output do PTY no buffer do xterm', async () => {
  const screen = render(<TerminalPane pane={{ id: 'p1', name: 'A', command: 'bash', cwd: '/tmp' }} />)
  await vi.waitFor(() => expect((window as unknown as { __emit?: unknown }).__emit).toBeTypeOf('function'))
  ;(window as unknown as { __emit: (d: string) => void }).__emit('READY\r\n')
  await expect.element(screen.getByText('READY')).toBeVisible()
})
```

- [ ] **Step 3: Rodar pra ver falhar**

Run: `npx vitest run --project pane`
Expected: FAIL — `TerminalPane` não existe.

- [ ] **Step 4: Implementar `src/renderer/term/TerminalPane.tsx`**

```tsx
import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { SearchAddon } from '@xterm/addon-search'
import { SerializeAddon } from '@xterm/addon-serialize'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import type { PaneConfig } from '@shared/types'
import { darkTheme } from './xtermTheme'
import { canEnableWebgl, releaseWebgl } from './webglPool'

export function TerminalPane({ pane }: { pane: PaneConfig }) {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = host.current
    if (!el) return
    let disposed = false
    const term = new Terminal({
      fontFamily: 'JetBrains Mono, monospace', fontSize: 13,
      scrollback: 5000, allowProposedApi: true, theme: darkTheme,
    })
    const fit = new FitAddon()
    const serialize = new SerializeAddon()
    term.loadAddon(fit)
    term.loadAddon(new Unicode11Addon())
    term.unicode.activeVersion = '11' // ANTES de escrever
    term.loadAddon(new SearchAddon())
    term.loadAddon(serialize)
    term.loadAddon(new WebLinksAddon((_e, uri) => window.term.invoke('shell:openExternal', { url: uri })))

    let cleanupData = () => {}
    let cleanupExit = () => {}
    let webgl: WebglAddon | null = null

    async function start() {
      const saved = await window.term.invoke('scrollback:load', { id: pane.id })
      if (disposed) return
      if (saved) term.write(saved)
      term.open(el!)
      fit.fit()

      if (canEnableWebgl(pane.id)) {
        webgl = new WebglAddon()
        webgl.onContextLoss(() => { webgl?.dispose(); webgl = null; releaseWebgl(pane.id) })
        term.loadAddon(webgl)
      }

      cleanupData = window.term.onPtyData(pane.id, ({ data }) => term.write(data))
      cleanupExit = window.term.onPtyExit(pane.id, ({ code, reason }) => {
        term.writeln(`\r\n\x1b[31m[processo terminou code=${code}${reason ? ' ' + reason : ''}]\x1b[0m`)
      })
      term.onData((d) => window.term.invoke('pty:write', { id: pane.id, data: d }))

      await window.term.invoke('pty:create', {
        id: pane.id, command: pane.command, args: pane.args, cwd: pane.cwd,
        env: pane.env, cols: term.cols, rows: term.rows,
      })
    }
    void start()

    const ro = new ResizeObserver(() => {
      fit.fit()
      void window.term.invoke('pty:resize', { id: pane.id, cols: term.cols, rows: term.rows })
    })
    ro.observe(el)

    return () => {
      disposed = true
      ro.disconnect()
      void window.term.invoke('scrollback:save', { id: pane.id, data: serialize.serialize() })
      cleanupData(); cleanupExit()
      webgl?.dispose(); releaseWebgl(pane.id)
      term.dispose()
    }
  }, [pane.id, pane.command, pane.cwd, pane.args, pane.env])

  return <div ref={host} className="h-full w-full" />
}
```

- [ ] **Step 5: Rodar pra ver passar**

Run: `npx vitest run --project pane`
Expected: PASS (1 teste). Nota: WebGL pode não inicializar em CI headless — o teste não depende dele (fallback DOM renderiza o texto).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/term/TerminalPane.tsx vitest.config.ts src/renderer/term/TerminalPane.browser.test.tsx
git commit -m "feat: TerminalPane (xterm<->PTY) + vitest Browser Mode"
```

---

## Task 10: Grid (layouts nomeados) + layoutStorage

**Files:**
- Create: `src/renderer/grid/layoutStorage.ts`, `src/renderer/grid/TwoPane.tsx`, `src/renderer/grid/ThreePane.tsx`, `src/renderer/grid/QuadPane.tsx`, `src/renderer/grid/Grid.tsx`

- [ ] **Step 1: Criar `src/renderer/grid/layoutStorage.ts` (Storage shim -> config:*)**

```ts
// Storage-shaped object para useDefaultLayout, espelhado em memória e persistido via config:set.
import type { AppConfig } from '@shared/types'

let cache: Record<string, number[]> = {}

export async function hydrateLayoutSizes(): Promise<void> {
  const cfg: AppConfig = await window.term.invoke('config:get', undefined)
  cache = cfg.layoutSizes ?? {}
}

export const layoutStorage: Storage = {
  getItem: (key) => (cache[key] ? JSON.stringify(cache[key]) : null),
  setItem: (key, value) => {
    cache[key] = JSON.parse(value) as number[]
    void window.term.invoke('config:set', { patch: { layoutSizes: { ...cache } } })
  },
  removeItem: (key) => { delete cache[key] },
  clear: () => { cache = {} },
  key: () => null,
  get length() { return Object.keys(cache).length },
} as Storage
```

- [ ] **Step 2: Criar `src/renderer/grid/TwoPane.tsx`**

```tsx
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import type { PaneConfig } from '@shared/types'
import { TerminalPane } from '../term/TerminalPane'
import { layoutStorage } from './layoutStorage'

const sep = 'w-1 bg-zinc-700 data-[separator=focus]:bg-sky-500'

export function TwoPane({ panes }: { panes: PaneConfig[] }) {
  const { defaultLayout, onLayoutChange } = useDefaultLayout({ groupId: 'grid-two', storage: layoutStorage })
  return (
    <Group orientation="horizontal" id="grid-two" defaultLayout={defaultLayout} onLayoutChange={onLayoutChange} className="h-full w-full">
      <Panel minSize="15%">{panes[0] && <TerminalPane key={panes[0].id} pane={panes[0]} />}</Panel>
      <Separator className={sep} />
      <Panel minSize="15%">{panes[1] && <TerminalPane key={panes[1].id} pane={panes[1]} />}</Panel>
    </Group>
  )
}
```

- [ ] **Step 3: Criar `src/renderer/grid/ThreePane.tsx`**

```tsx
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import type { PaneConfig } from '@shared/types'
import { TerminalPane } from '../term/TerminalPane'
import { layoutStorage } from './layoutStorage'

const sep = 'w-1 bg-zinc-700 data-[separator=focus]:bg-sky-500'

export function ThreePane({ panes }: { panes: PaneConfig[] }) {
  const { defaultLayout, onLayoutChange } = useDefaultLayout({ groupId: 'grid-three', storage: layoutStorage })
  return (
    <Group orientation="horizontal" id="grid-three" defaultLayout={defaultLayout} onLayoutChange={onLayoutChange} className="h-full w-full">
      <Panel minSize="15%">{panes[0] && <TerminalPane key={panes[0].id} pane={panes[0]} />}</Panel>
      <Separator className={sep} />
      <Panel minSize="15%">{panes[1] && <TerminalPane key={panes[1].id} pane={panes[1]} />}</Panel>
      <Separator className={sep} />
      <Panel minSize="15%">{panes[2] && <TerminalPane key={panes[2].id} pane={panes[2]} />}</Panel>
    </Group>
  )
}
```

- [ ] **Step 4: Criar `src/renderer/grid/QuadPane.tsx`**

```tsx
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import type { PaneConfig } from '@shared/types'
import { TerminalPane } from '../term/TerminalPane'
import { layoutStorage } from './layoutStorage'

const vsep = 'w-1 bg-zinc-700 data-[separator=focus]:bg-sky-500'
const hsep = 'h-1 bg-zinc-700 data-[separator=focus]:bg-sky-500'

export function QuadPane({ panes }: { panes: PaneConfig[] }) {
  const { defaultLayout, onLayoutChange } = useDefaultLayout({ groupId: 'grid-quad', storage: layoutStorage })
  return (
    <Group orientation="vertical" id="grid-quad" defaultLayout={defaultLayout} onLayoutChange={onLayoutChange} className="h-full w-full">
      <Panel minSize="20%">
        <Group orientation="horizontal" id="grid-quad-top" className="h-full w-full">
          <Panel minSize="15%">{panes[0] && <TerminalPane key={panes[0].id} pane={panes[0]} />}</Panel>
          <Separator className={vsep} />
          <Panel minSize="15%">{panes[1] && <TerminalPane key={panes[1].id} pane={panes[1]} />}</Panel>
        </Group>
      </Panel>
      <Separator className={hsep} />
      <Panel minSize="20%">
        <Group orientation="horizontal" id="grid-quad-bottom" className="h-full w-full">
          <Panel minSize="15%">{panes[2] && <TerminalPane key={panes[2].id} pane={panes[2]} />}</Panel>
          <Separator className={vsep} />
          <Panel minSize="15%">{panes[3] && <TerminalPane key={panes[3].id} pane={panes[3]} />}</Panel>
        </Group>
      </Panel>
    </Group>
  )
}
```

- [ ] **Step 5: Criar `src/renderer/grid/Grid.tsx` (remount por layout)**

```tsx
import { useGrid } from '../store/gridStore'
import { TwoPane } from './TwoPane'
import { ThreePane } from './ThreePane'
import { QuadPane } from './QuadPane'

export function Grid() {
  const layout = useGrid((s) => s.activeLayout)
  const panes = useGrid((s) => s.panes)
  if (layout === 'two') return <TwoPane panes={panes} />
  if (layout === 'three') return <ThreePane panes={panes} />
  return <QuadPane panes={panes} />
}
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/grid
git commit -m "feat: Grid com layouts nomeados (two/three/quad) + layoutStorage"
```

---

## Task 11: UI shell (Sidebar, Toolbar, App, main.tsx, CSS)

**Files:**
- Create: `src/renderer/ui/Toolbar.tsx`, `src/renderer/ui/Sidebar.tsx`, `src/renderer/App.tsx`, `src/renderer/main.tsx`, `src/renderer/index.css`, `src/renderer/index.html`

- [ ] **Step 1: Criar `src/renderer/index.css`**

```css
@import "tailwindcss";
html, body, #root { height: 100%; margin: 0; background: #0d1117; color: #c9d1d9; }
```

- [ ] **Step 2: Criar `src/renderer/index.html`**

```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:" />
    <title>HiveTerm Clone</title>
  </head>
  <body><div id="root"></div><script type="module" src="./main.tsx"></script></body>
</html>
```

- [ ] **Step 3: Criar `src/renderer/ui/Toolbar.tsx` (trocar layout + novo terminal)**

```tsx
import { useGrid } from '../store/gridStore'
import type { LayoutKind } from '@shared/types'

const layouts: { key: LayoutKind; label: string }[] = [
  { key: 'two', label: '2' }, { key: 'three', label: '3' }, { key: 'quad', label: '2x2' },
]

export function Toolbar({ onNewTerminal }: { onNewTerminal: () => void }) {
  const active = useGrid((s) => s.activeLayout)
  const setLayout = useGrid((s) => s.setLayout)
  return (
    <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-1.5">
      <span className="text-xs text-zinc-400">Layout</span>
      {layouts.map((l) => (
        <button key={l.key} onClick={() => setLayout(l.key)}
          className={`rounded px-2 py-0.5 text-xs ${active === l.key ? 'bg-sky-600 text-white' : 'bg-zinc-800 text-zinc-300'}`}>
          {l.label}
        </button>
      ))}
      <button onClick={onNewTerminal} className="ml-auto rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-200">+ terminal</button>
    </div>
  )
}
```

- [ ] **Step 4: Criar `src/renderer/ui/Sidebar.tsx`**

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
          className={`flex items-center justify-between rounded px-2 py-1 ${active === p.id ? 'bg-zinc-800' : ''}`}>
          <span className="truncate">{p.name}</span>
          <button onClick={(e) => { e.stopPropagation(); removePane(p.id); void window.term.invoke('pty:kill', { id: p.id }) }}
            className="text-zinc-500 hover:text-red-400">×</button>
        </div>
      ))}
    </aside>
  )
}
```

- [ ] **Step 5: Criar `src/renderer/App.tsx` (com persistência de panes)**

```tsx
import { useEffect } from 'react'
import { Sidebar } from './ui/Sidebar'
import { Toolbar } from './ui/Toolbar'
import { Grid } from './grid/Grid'
import { useGrid } from './store/gridStore'
import { hydrateLayoutSizes } from './grid/layoutStorage'
import type { AppConfig, PaneConfig } from '@shared/types'

function uuid(): string { return crypto.randomUUID() }
const defaultCommand = navigator.platform.startsWith('Win') ? 'powershell.exe' : 'bash'

export function App() {
  const panes = useGrid((s) => s.panes)
  const addPane = useGrid((s) => s.addPane)
  const setLayout = useGrid((s) => s.setLayout)

  useEffect(() => {
    void (async () => {
      await hydrateLayoutSizes()
      const cfg: AppConfig = await window.term.invoke('config:get', undefined)
      setLayout(cfg.activeLayout)
      cfg.panes.forEach(addPane)
    })()
  }, [addPane, setLayout])

  // persiste panes + layout sempre que mudarem
  useEffect(() => {
    void window.term.invoke('config:set', { patch: { panes, activeLayout: useGrid.getState().activeLayout } })
  }, [panes])

  function newTerminal() {
    const p: PaneConfig = { id: uuid(), name: defaultCommand, command: defaultCommand, cwd: '.' }
    addPane(p)
  }

  return (
    <div className="flex h-full w-full flex-col">
      <Toolbar onNewTerminal={newTerminal} />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1"><Grid /></main>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Criar `src/renderer/main.tsx`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
```

- [ ] **Step 7: Rodar o app em dev (verificação manual)**

Run: `npm run dev`
Expected: janela abre; clicar "+ terminal" abre um shell num pane; digitar `echo oi` mostra `oi`; trocar 2/3/2x2 funciona; arrastar splitter redimensiona e reflui o terminal. Fechar e reabrir restaura panes/layout.

- [ ] **Step 8: Commit**

```bash
git add src/renderer
git commit -m "feat: UI shell (toolbar, sidebar, App) com persistência de panes"
```

---

## Task 12: Packaging (electron-builder) + E2E + CI

**Files:**
- Create: `electron-builder.yml`, `playwright.config.ts`, `e2e/terminal.spec.ts`, `.github/workflows/test.yml`

- [ ] **Step 1: Criar `electron-builder.yml`**

```yaml
appId: com.example.hivetermclone
productName: HiveTerm Clone
asar: true
asarUnpack:
  - "**/node_modules/node-pty/build/Release/*"
  - "**/node_modules/node-pty/prebuilds/**"
directories:
  output: release
files:
  - out/**
win:
  target: nsis
mac:
  target: [dmg, zip]
linux:
  target: [AppImage, deb]
```

- [ ] **Step 2: Criar `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: process.env.CI ? 2 : 0,
  use: { trace: 'on-first-retry' },
})
```

- [ ] **Step 3: Criar `e2e/terminal.spec.ts`**

```ts
import { test, expect, _electron as electron } from '@playwright/test'

test('app abre e spawna um terminal', async () => {
  const app = await electron.launch({ args: ['.'] })
  await app.evaluate(async ({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })
  })
  const win = await app.firstWindow()
  await win.getByRole('button', { name: '+ terminal' }).click()
  await expect(win.locator('.xterm-screen')).toHaveCount(1)
  await win.keyboard.type('echo hi\n')
  await expect(win.getByText('hi')).toBeVisible({ timeout: 15_000 })
  await app.close()
})
```

- [ ] **Step 4: Rodar E2E local (após build)**

Run: `npm run build && npm run test:e2e`
Expected: PASS — terminal abre, `hi` aparece. (Linux precisa display; use `xvfb-run` se headless.)

- [ ] **Step 5: Criar `.github/workflows/test.yml`**

```yaml
name: test
on: [push, pull_request]
jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: npx @electron/rebuild -f -w node-pty
      - run: npm run typecheck
      - run: npm run test:unit
      - run: npx playwright install --with-deps chromium
      - run: npm run test:component
      - run: npm run build
      - run: ${{ runner.os == 'Linux' && 'xvfb-run -a ' || '' }}npm run test:e2e
        env: { PWTEST_TRACE: on-first-retry }
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: traces-${{ matrix.os }}, path: test-results/** }
```

- [ ] **Step 6: Commit**

```bash
git add electron-builder.yml playwright.config.ts e2e/terminal.spec.ts .github/workflows/test.yml
git commit -m "chore: packaging (electron-builder), E2E playwright, CI matrix"
```

---

## Self-Review (preenchido)

**Cobertura da spec:**
- §1 critérios 1–8 → Tasks 4 (spawn/lifecycle), 9 (xterm I/O, reflow, scrollback), 10/11 (layouts, troca), 7/11 (persistência, quit cleanup), 3 (spawn .cmd Win), 7 (sandbox). ✔
- §3 modelo de processos → Tasks 6 (utilityProcess), 7 (main/preload, CSP, sender guard). ✔
- §4 unidades → 1 task por unidade (4.1→T4, 4.2→T7, 4.3→T7, 4.4→T5, 4.5→T8, 4.6→T10, 4.7→T9). ✔
- §6 erros → T4 (spawn falha/exit), T9 (exit banner, WebGL context loss), T7 (sender/zod), T5 (migração). ✔ Crash do PtyHost: bridge detecta `proc` ausente (no-op); respawn explícito fica como melhoria pós-v1 (anotado, não bloqueia critérios).
- §7 testes → T2, T4, T5, T8 (unit), T9 (Browser Mode), T12 (E2E + CI). ✔

**Placeholder scan:** nenhum TBD/TODO; todo passo de código tem código completo. ✔

**Consistência de tipos:** `PaneConfig`/`AppConfig`/`LayoutKind` (T2) usados igual em T5/T8/T9/T10/T11. Canais (`pty:create` etc.) e `ptyDataChannel`/`ptyExitChannel` (T2) consistentes em T6/T7/T9. `PtyManager` sinks `onData(id,data)`/`onExit(id,code,reason)` (T4) batem com `ptyHostEntry` (T6). `window.term` API (T7 preload) bate com usos em T9/T10/T11. ✔

**Nota de gap aceito:** auto-restart de PTY e respawn automático do PtyHost são polish (sub-projeto #8); v1 reporta o exit e oferece restart manual via remover+readicionar pane.
