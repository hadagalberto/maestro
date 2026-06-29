# Polish: Pins & Notes + Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-project Pins (checklist) & Notes (scratchpad) with Queen MCP tools and a panel; auto-restart of terminals (cap+backoff); cascade-kill of sub-agents.

**Architecture:** A main `PinsStore` (electron-store, keyed by project root) backs IPC `pins:*`/`notes:*` and 8 new Queen tools; every mutation pushes `pins:changed` so MCP-created pins appear live. Reliability: a pure `nextRestart` decision + TerminalPane respawn, and a pure `gridStore.removePaneTree` for cascade-kill.

**Tech Stack:** existing — electron-store, @modelcontextprotocol/sdk, React 19 + zustand, vitest + Playwright. No new deps.

**Spec:** `docs/superpowers/specs/2026-06-28-polish-pins-notes-reliability-design.md`

---

## File Structure

```
+ src/shared/pins.ts             Pin/PinsData
~ src/shared/types.ts            ProfileEntry/PaneConfig += autoRestart?
~ src/shared/schemas.ts          pins/notes schemas + autoRestart on profileEntry/paneConfig
~ src/shared/ipc.ts              pins:*/notes:* channels + pins:changed
+ src/main/pins/pinsStore.ts     PinsStore
~ src/main/queen/tools.ts        8 pin/notes tools (+ pins + onPinsChanged deps)
~ src/main/ipcRouter.ts          pins:*/notes:* handlers (emit pins:changed)
~ src/main/index.ts              construct PinsStore; pins:changed pusher; deps wiring
~ src/preload/index.ts           onPinsChanged(cb)
+ src/renderer/reliability/restart.ts  nextRestart
~ src/renderer/store/gridStore.ts  removePaneTree
~ src/renderer/term/TerminalPane.tsx  autoRestart on exit
~ src/renderer/ui/AgentTreeView.tsx  kill uses removePaneTree
+ src/renderer/store/pinsStore.ts
+ src/renderer/ui/PinsPanel.tsx
~ src/renderer/App.tsx           Pins button + panel + onPinsChanged
~ e2e/pins.spec.ts
```

---

## Task 1: shared pins types + schemas + ipc + autoRestart

**Files:** `src/shared/pins.ts`, `src/shared/types.ts`, `src/shared/schemas.ts`, `src/shared/ipc.ts`

- [ ] **Step 1: Create `src/shared/pins.ts`**

```ts
export interface Pin { id: string; text: string; done: boolean; terminalId?: string; createdAt: number }
export interface PinsData { pins: Pin[]; notes: string }
```

- [ ] **Step 2: `src/shared/types.ts`** — add `autoRestart?` to `ProfileEntry` AND `PaneConfig`

Add `autoRestart?: boolean` to both interfaces (keep all existing fields).

- [ ] **Step 3: `src/shared/schemas.ts`** — schemas + autoRestart fields

Add `autoRestart: z.boolean().optional()` into both `profileEntrySchema` and `paneConfigSchema` (the existing `z.object({...})`s). Append:
```ts
export const pinCreateArgs = z.object({ text: z.string().min(1), terminalId: z.string().optional() })
export const pinUpdateArgs = z.object({ id: z.string().min(1), text: z.string().min(1) })
export const pinDoneArgs = z.object({ id: z.string().min(1), done: z.boolean() })
export const pinIdArgs = z.object({ id: z.string().min(1) })
export const notesSetArgs = z.object({ notes: z.string() })
export const notesAppendArgs = z.object({ chunk: z.string() })
```
Add to `schemaByChannel`:
```ts
  'pins:create': pinCreateArgs,
  'pins:update': pinUpdateArgs,
  'pins:setDone': pinDoneArgs,
  'pins:delete': pinIdArgs,
  'notes:set': notesSetArgs,
  'notes:append': notesAppendArgs,
```
(`pins:list`, `notes:get` — no args.)

- [ ] **Step 4: `src/shared/ipc.ts`** — channels + event

Add `import type { Pin } from './pins'`. Append to `IpcRequest`:
```ts
  'pins:list': { args: undefined; result: Pin[] }
  'pins:create': { args: { text: string; terminalId?: string }; result: Pin[] }
  'pins:update': { args: { id: string; text: string }; result: Pin[] }
  'pins:setDone': { args: { id: string; done: boolean }; result: Pin[] }
  'pins:delete': { args: { id: string }; result: Pin[] }
  'notes:get': { args: undefined; result: string }
  'notes:set': { args: { notes: string }; result: void }
  'notes:append': { args: { chunk: string }; result: void }
```
(`pins:*` mutations return the fresh pin list for convenience.) Re-export `export type { Pin, PinsData } from './pins'`. The `pins:changed` push is a fixed channel handled in preload (Task 4 step) — add to the `AppEvent` union if one exists, OR document it as a raw channel. Use a raw channel `pins:changed` (no payload) subscribed via a new preload method.

- [ ] **Step 5: Typecheck + unit**

Run: `npm run typecheck && npm run test:unit` → typecheck 0; unit green (140). (autoRestart optional → no break.)

- [ ] **Step 6: Commit**

```bash
git add src/shared/pins.ts src/shared/types.ts src/shared/schemas.ts src/shared/ipc.ts
git commit -m "feat: shared pins/notes types + schemas + ipc + autoRestart field"
```

---

## Task 2: PinsStore

**Files:** `src/main/pins/pinsStore.ts`; Test `src/main/pins/pinsStore.test.ts`

- [ ] **Step 1: Write failing test `src/main/pins/pinsStore.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockStore, data } = vi.hoisted(() => {
  const data: Record<string, unknown> = {}
  const mockStore = { get: (k: string) => data[k], set: vi.fn((k: string, v: unknown) => { data[k] = v }) }
  return { mockStore, data }
})
vi.mock('electron-store', () => ({ default: vi.fn(function () { return mockStore }) }))
import { PinsStore } from './pinsStore'

beforeEach(() => { for (const k of Object.keys(data)) delete data[k]; mockStore.set.mockClear() })

describe('PinsStore', () => {
  it('createPin + listPins por projeto', () => {
    const s = new PinsStore()
    const p = s.createPin('/a', 'fazer X')
    expect(p.text).toBe('fazer X'); expect(p.done).toBe(false)
    expect(s.listPins('/a')).toHaveLength(1)
    expect(s.listPins('/b')).toHaveLength(0) // outro projeto isolado
  })
  it('setPinDone / updatePin / deletePin', () => {
    const s = new PinsStore()
    const p = s.createPin('/a', 'x')
    s.setPinDone('/a', p.id, true); expect(s.listPins('/a')[0].done).toBe(true)
    s.updatePin('/a', p.id, 'y'); expect(s.listPins('/a')[0].text).toBe('y')
    s.deletePin('/a', p.id); expect(s.listPins('/a')).toHaveLength(0)
  })
  it('notes get/set/append', () => {
    const s = new PinsStore()
    expect(s.getNotes('/a')).toBe('')
    s.setNotes('/a', 'linha1'); expect(s.getNotes('/a')).toBe('linha1')
    s.appendNotes('/a', 'linha2'); expect(s.getNotes('/a')).toBe('linha1\nlinha2')
    s.appendNotes('/b', 'só'); expect(s.getNotes('/b')).toBe('só')
  })
})
```

- [ ] **Step 2: Run to see fail** — `npx vitest run src/main/pins/pinsStore.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/main/pins/pinsStore.ts`**

```ts
import ElectronStore from 'electron-store'
import { randomUUID } from 'node:crypto'
import type { Pin, PinsData } from '@shared/pins'

const Store = (ElectronStore as unknown as { default?: typeof ElectronStore }).default ?? ElectronStore
const EMPTY: PinsData = { pins: [], notes: '' }
const CAP = 500

export class PinsStore {
  private store = new Store<{ byProject: Record<string, PinsData> }>({ name: 'maestro-pins' })
  private all(): Record<string, PinsData> { return this.store.get('byProject') ?? {} }
  private save(root: string, d: PinsData): void { const all = this.all(); all[root] = d; this.store.set('byProject', all) }

  get(root: string): PinsData { return this.all()[root] ?? EMPTY }
  listPins(root: string): Pin[] { return this.get(root).pins }
  createPin(root: string, text: string, terminalId?: string): Pin {
    const d = this.get(root)
    const pin: Pin = { id: randomUUID(), text, done: false, terminalId, createdAt: Date.now() }
    this.save(root, { ...d, pins: [...d.pins, pin].slice(-CAP) })
    return pin
  }
  updatePin(root: string, id: string, text: string): void { const d = this.get(root); this.save(root, { ...d, pins: d.pins.map((p) => (p.id === id ? { ...p, text } : p)) }) }
  setPinDone(root: string, id: string, done: boolean): void { const d = this.get(root); this.save(root, { ...d, pins: d.pins.map((p) => (p.id === id ? { ...p, done } : p)) }) }
  deletePin(root: string, id: string): void { const d = this.get(root); this.save(root, { ...d, pins: d.pins.filter((p) => p.id !== id) }) }
  getNotes(root: string): string { return this.get(root).notes }
  setNotes(root: string, notes: string): void { this.save(root, { ...this.get(root), notes }) }
  appendNotes(root: string, chunk: string): void { const cur = this.getNotes(root); this.setNotes(root, cur ? `${cur}\n${chunk}` : chunk) }
}
```

- [ ] **Step 4: Run to see pass** — `npx vitest run src/main/pins/pinsStore.test.ts` → 3 PASS. `npm run typecheck` → 0.

- [ ] **Step 5: Commit**

```bash
git add src/main/pins/pinsStore.ts src/main/pins/pinsStore.test.ts
git commit -m "feat: PinsStore (per-project pins + notes, electron-store)"
```

---

## Task 3: Queen pin/notes tools

**Files:** `src/main/queen/tools.ts`; Test `src/main/queen/tools.test.ts` (extend)

- [ ] **Step 1: Extend `QueenToolDeps` + register 8 tools in `src/main/queen/tools.ts`**

Add to `QueenToolDeps`: `pins: import('../pins/pinsStore').PinsStore` (prefer top `import type { PinsStore } from '../pins/pinsStore'`; then `pins: PinsStore`) and `onPinsChanged: () => void`. Register after the sub-agent tools:
```ts
  const proj = () => deps.currentProject()
  const noProj = () => err('nenhum projeto aberto')
  const changed = <T>(v: T): T => { deps.onPinsChanged(); return v }

  reg('list_pins', { title: 'List pins', description: 'List project pins (checklist)', inputSchema: {} },
    () => { const r = proj(); return r ? json(deps.pins.listPins(r)) : noProj() })
  reg('create_pin', { title: 'Create pin', description: 'Add a checklist pin to the project', inputSchema: { text: z.string() } },
    (a) => { const r = proj(); if (!r) return noProj(); const p = deps.pins.createPin(r, a.text as string); deps.onPinsChanged(); return json(p) })
  reg('update_pin', { title: 'Update pin', description: 'Edit a pin text', inputSchema: { id: z.string(), text: z.string() } },
    (a) => { const r = proj(); if (!r) return noProj(); deps.pins.updatePin(r, a.id as string, a.text as string); return changed(ok('updated')) })
  reg('set_pin_done', { title: 'Set pin done', description: 'Mark a pin done/undone', inputSchema: { id: z.string(), done: z.boolean() } },
    (a) => { const r = proj(); if (!r) return noProj(); deps.pins.setPinDone(r, a.id as string, a.done as boolean); return changed(ok('ok')) })
  reg('delete_pin', { title: 'Delete pin', description: 'Remove a pin', inputSchema: { id: z.string() } },
    (a) => { const r = proj(); if (!r) return noProj(); deps.pins.deletePin(r, a.id as string); return changed(ok('deleted')) })
  reg('get_notes', { title: 'Get notes', description: 'Get the project scratchpad notes', inputSchema: {} },
    () => { const r = proj(); return r ? ok(deps.pins.getNotes(r)) : noProj() })
  reg('set_notes', { title: 'Set notes', description: 'Replace the project scratchpad notes', inputSchema: { notes: z.string() } },
    (a) => { const r = proj(); if (!r) return noProj(); deps.pins.setNotes(r, a.notes as string); return changed(ok('saved')) })
  reg('append_notes', { title: 'Append notes', description: 'Append a line to the project notes', inputSchema: { chunk: z.string() } },
    (a) => { const r = proj(); if (!r) return noProj(); deps.pins.appendNotes(r, a.chunk as string); return changed(ok('appended')) })
```
(Queen now 24 tools.)

- [ ] **Step 2: Extend `src/main/queen/tools.test.ts`**

In `deps()` add `pins: new (await import...)` — but deps() is sync, so add a top `import { PinsStore } from '../pins/pinsStore'` and in the returned object add `pins: new PinsStore()` and `onPinsChanged: vi.fn()`. NOTE: PinsStore uses real electron-store; in the tools.test it isn't mocked → `new Store({name})` would try the real electron-store (needs app). To avoid that, mock electron-store at the top of tools.test.ts the same way pinsStore.test.ts does (vi.hoisted + vi.mock('electron-store',...)). Add that mock. Then update the tool-count assertion from 16 to 24, and add:
```ts
  it('create_pin cria e dispara onPinsChanged', async () => {
    const mcp = new McpServer({ name: 't', version: '1' }); const d = deps()
    const handlers = registerQueenTools(mcp, d)
    const r = await handlers['create_pin']({ text: 'x' })
    expect((r as { content: { text: string }[] }).content[0].text).toContain('"text":"x"')
    expect(d.onPinsChanged).toHaveBeenCalled()
  })
  it('set_notes/get_notes round-trip', async () => {
    const mcp = new McpServer({ name: 't', version: '1' }); const d = deps()
    const handlers = registerQueenTools(mcp, d)
    await handlers['set_notes']({ notes: 'oi' })
    const r = await handlers['get_notes']({})
    expect((r as { content: { text: string }[] }).content[0].text).toBe('oi')
  })
```
(deps() default `currentProject: () => null` would make these isError; override to `currentProject: () => '/proj'` in these two tests via `deps({ currentProject: () => '/proj' })`.)

- [ ] **Step 3: Run + typecheck** — `npx vitest run src/main/queen/tools.test.ts && npm run typecheck` → pass; 0.

- [ ] **Step 4: Commit**

```bash
git add src/main/queen/tools.ts src/main/queen/tools.test.ts
git commit -m "feat: Queen pin/notes tools (list/create/update/set_done/delete + notes get/set/append)"
```

---

## Task 4: IPC handlers + main wiring + preload event

**Files:** `src/main/ipcRouter.ts`, `src/main/index.ts`, `src/preload/index.ts`

- [ ] **Step 1: Extend `src/main/ipcRouter.ts`**

Add to `RouterDeps`: `pins: PinsStore` (top `import type { PinsStore } from './pins/pinsStore'`) and `emitPinsChanged: () => void`. Handlers (root via existing `currentProjectRoot`):
```ts
  const proot = () => deps.currentProjectRoot()
  const pinsChanged = () => deps.emitPinsChanged()
  handle('pins:list', () => { const r = proot(); return r ? deps.pins.listPins(r) : [] })
  handle('pins:create', (a) => { const r = proot(); if (r) { deps.pins.createPin(r, a.text, a.terminalId); pinsChanged() } return r ? deps.pins.listPins(r) : [] })
  handle('pins:update', (a) => { const r = proot(); if (r) { deps.pins.updatePin(r, a.id, a.text); pinsChanged() } return r ? deps.pins.listPins(r) : [] })
  handle('pins:setDone', (a) => { const r = proot(); if (r) { deps.pins.setPinDone(r, a.id, a.done); pinsChanged() } return r ? deps.pins.listPins(r) : [] })
  handle('pins:delete', (a) => { const r = proot(); if (r) { deps.pins.deletePin(r, a.id); pinsChanged() } return r ? deps.pins.listPins(r) : [] })
  handle('notes:get', () => { const r = proot(); return r ? deps.pins.getNotes(r) : '' })
  handle('notes:set', (a) => { const r = proot(); if (r) { deps.pins.setNotes(r, a.notes); pinsChanged() } })
  handle('notes:append', (a) => { const r = proot(); if (r) { deps.pins.appendNotes(r, a.chunk); pinsChanged() } })
```

- [ ] **Step 2: Extend `src/main/index.ts`**

Add `import { PinsStore } from './pins/pinsStore'`. Construct `const pins = new PinsStore()`. Define `const emitPinsChanged = () => { if (win && !win.webContents.isDestroyed()) win.webContents.send('pins:changed') }`. Pass `pins` + `emitPinsChanged` to `registerIpc({...})` deps. In the Queen `startQueen({...})` deps add `pins` and `onPinsChanged: emitPinsChanged`.

- [ ] **Step 3: Extend `src/preload/index.ts`** — `onPinsChanged`

Add to `api`:
```ts
  onPinsChanged(cb: () => void): () => void {
    const h = () => cb()
    ipcRenderer.on('pins:changed', h)
    return () => ipcRenderer.removeListener('pins:changed', h)
  },
```

- [ ] **Step 4: Typecheck + unit + build**

Run: `npm run typecheck && npm run test:unit && npm run build` → all green/clean; `grep -c shiki out/main/index.js` still 0.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipcRouter.ts src/main/index.ts src/preload/index.ts
git commit -m "feat: pins/notes IPC + PinsStore wiring + pins:changed push + preload"
```

---

## Task 5: Reliability — nextRestart + removePaneTree + TerminalPane + AgentTreeView

**Files:** `src/renderer/reliability/restart.ts` (+test); `src/renderer/store/gridStore.ts`; `src/renderer/term/TerminalPane.tsx`; `src/renderer/ui/AgentTreeView.tsx`; Test additions in `gridStore.test.ts`

- [ ] **Step 1: Write failing test `src/renderer/reliability/restart.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { nextRestart } from './restart'

describe('nextRestart', () => {
  it('autoRestart off -> não', () => expect(nextRestart(false, 1, 0).restart).toBe(false))
  it('exit 0 -> não', () => expect(nextRestart(true, 0, 0).restart).toBe(false))
  it('code!=0 e count<max -> sim com backoff crescente', () => {
    expect(nextRestart(true, 1, 0)).toEqual({ restart: true, delayMs: 500 })
    expect(nextRestart(true, 1, 1)).toEqual({ restart: true, delayMs: 1000 })
    expect(nextRestart(true, 1, 2)).toEqual({ restart: true, delayMs: 2000 })
  })
  it('count>=max -> não', () => expect(nextRestart(true, 1, 3).restart).toBe(false))
})
```

- [ ] **Step 2: Implement `src/renderer/reliability/restart.ts`**

```ts
export function nextRestart(autoRestart: boolean | undefined, code: number, count: number, max = 3): { restart: boolean; delayMs: number } {
  if (!autoRestart || code === 0 || count >= max) return { restart: false, delayMs: 0 }
  return { restart: true, delayMs: 500 * 2 ** count }
}
```
Run: `npx vitest run src/renderer/reliability/restart.test.ts` → 4 PASS.

- [ ] **Step 3: `src/renderer/store/gridStore.ts`** — add `removePaneTree`

Add to the interface + store:
```ts
  removePaneTree: (id: string) => string[]
```
```ts
  removePaneTree: (id) => {
    const s = get()
    const ids = new Set<string>()
    const visit = (pid: string) => { if (ids.has(pid)) return; ids.add(pid); for (const c of s.panes) if (c.parentId === pid) visit(c.id) }
    visit(id)
    set({ panes: s.panes.filter((p) => !ids.has(p.id)), activePaneId: ids.has(s.activePaneId ?? '') ? null : s.activePaneId })
    return [...ids]
  },
```

- [ ] **Step 4: Add gridStore test (cascade) in `src/renderer/store/gridStore.test.ts`**

```ts
  it('removePaneTree remove descendentes', () => {
    useGrid.setState({ activeLayout: 'two', activePaneId: null, panes: [
      { id: 'a', name: 'a', command: 'x', cwd: '.' },
      { id: 'b', name: 'b', command: 'x', cwd: '.', parentId: 'a' },
      { id: 'c', name: 'c', command: 'x', cwd: '.', parentId: 'b' },
      { id: 'z', name: 'z', command: 'x', cwd: '.' },
    ] })
    const removed = useGrid.getState().removePaneTree('a')
    expect(removed.sort()).toEqual(['a', 'b', 'c'])
    expect(useGrid.getState().panes.map((p) => p.id)).toEqual(['z'])
  })
```
(Adapt the setState shape to the real gridStore state fields — include `exited: {}` if required by the type.)

- [ ] **Step 5: `src/renderer/term/TerminalPane.tsx`** — autoRestart on exit

Import `nextRestart` from '../reliability/restart'. Add a restart-count ref: `const restarts = useRef(0)`. In the `onPtyExit` handler, after `setExited`/banner, decide:
```ts
      cleanupExit = window.term.onPtyExit(pane.id, ({ code, reason }) => {
        useGrid.getState().setExited(pane.id, code)
        const { restart, delayMs } = nextRestart(pane.autoRestart, code, restarts.current)
        if (restart) {
          restarts.current += 1
          term.writeln(`\r\n\x1b[33m[reiniciando ${restarts.current}/3 em ${delayMs}ms…]\x1b[0m`)
          setTimeout(() => { if (!disposed) void window.term.invoke('pty:create', { id: pane.id, command: pane.command, args: pane.args, cwd: pane.cwd, env: pane.env, cols: term.cols, rows: term.rows, origin: pane.origin ?? 'user', projectRoot: pane.projectRoot, name: pane.name, parentId: pane.parentId }) }, delayMs)
        } else {
          term.writeln(`\r\n\x1b[31m[processo terminou code=${code}${reason ? ' ' + reason : ''}]\x1b[0m`)
        }
      })
```
(Replace the existing exit banner with this branch. `disposed` is the existing effect-cleanup flag.)

- [ ] **Step 5b: copy `autoRestart` into panes — `src/renderer/App.tsx` + `src/renderer/queen/queenBridge.ts`**

Both `paneFromProfile` functions build a `PaneConfig` from a `Profile`. Add `autoRestart: p.autoRestart` to the returned object in BOTH (App.tsx's `paneFromProfile` and queenBridge.ts's `paneFromProfile`). Without this, `pane.autoRestart` is always undefined and auto-restart never fires. (`Profile` already carries `autoRestart` from the merged `ProfileEntry`; if the renderer `Profile` type doesn't include it, also add `autoRestart?: boolean` to the `Profile` interface in `src/shared/types.ts` and ensure `mergeProfiles` copies it from the entry — check `profileMerge.ts`'s `toProfile` and add `autoRestart: e.autoRestart` there if missing.)

- [ ] **Step 6: `src/renderer/ui/AgentTreeView.tsx`** — kill uses removePaneTree

Change the × kill handler from `removePane(p.id); pty:kill(p.id)` to:
```tsx
          <button onClick={(e) => { e.stopPropagation(); const ids = useGrid.getState().removePaneTree(p.id); for (const id of ids) void window.term.invoke('pty:kill', { id }) }} className="text-zinc-500 hover:text-red-400">×</button>
```
(Use `useGrid.getState().removePaneTree` directly; remove the now-unused `removePane` selector if it becomes unused — or keep it if still referenced.)

- [ ] **Step 7: Verify**

Run: `npm run typecheck && npm run test:unit && npm run test:component && npm run build`
Expected: all green (restart 4 + gridStore cascade test pass).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/reliability src/renderer/store/gridStore.ts src/renderer/store/gridStore.test.ts src/renderer/term/TerminalPane.tsx src/renderer/ui/AgentTreeView.tsx
git commit -m "feat: auto-restart (nextRestart + TerminalPane) + cascade-kill (removePaneTree)"
```

---

## Task 6: Renderer pinsStore + PinsPanel + App

**Files:** `src/renderer/store/pinsStore.ts`; `src/renderer/ui/PinsPanel.tsx`; `src/renderer/App.tsx`; Test `src/renderer/ui/PinsPanel.browser.test.tsx`

- [ ] **Step 1: Create `src/renderer/store/pinsStore.ts`**

```ts
import { create } from 'zustand'
import type { Pin } from '@shared/pins'

interface PinsStore {
  pins: Pin[]
  notes: string
  refresh: () => Promise<void>
  addPin: (text: string) => Promise<void>
  toggle: (id: string, done: boolean) => Promise<void>
  edit: (id: string, text: string) => Promise<void>
  remove: (id: string) => Promise<void>
  setNotes: (notes: string) => void
}

let notesTimer: ReturnType<typeof setTimeout> | null = null

export const usePins = create<PinsStore>((set, get) => ({
  pins: [], notes: '',
  refresh: async () => { const [pins, notes] = await Promise.all([window.term.invoke('pins:list', undefined), window.term.invoke('notes:get', undefined)]); set({ pins, notes }) },
  addPin: async (text) => { if (!text.trim()) return; set({ pins: await window.term.invoke('pins:create', { text }) }) },
  toggle: async (id, done) => { set({ pins: await window.term.invoke('pins:setDone', { id, done }) }) },
  edit: async (id, text) => { set({ pins: await window.term.invoke('pins:update', { id, text }) }) },
  remove: async (id) => { set({ pins: await window.term.invoke('pins:delete', { id }) }) },
  setNotes: (notes) => { set({ notes }); if (notesTimer) clearTimeout(notesTimer); notesTimer = setTimeout(() => { void window.term.invoke('notes:set', { notes }) }, 600) },
}))
```

- [ ] **Step 2: Create `src/renderer/ui/PinsPanel.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { usePins } from '../store/pinsStore'

export function PinsPanel({ onClose }: { onClose: () => void }) {
  const { pins, notes, refresh, addPin, toggle, remove, setNotes } = usePins()
  const [draft, setDraft] = useState('')
  useEffect(() => { void refresh() }, [refresh])
  return (
    <div className="absolute inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="flex h-full w-[420px] flex-col border-l border-zinc-700 bg-zinc-900 text-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center border-b border-zinc-800 px-3 py-2"><span className="font-medium">Pins &amp; Notes</span><button onClick={onClose} className="ml-auto text-xs text-zinc-400">fechar</button></div>
        <div className="border-b border-zinc-800 p-2">
          <div className="mb-1 text-[10px] uppercase text-zinc-500">Pins</div>
          {pins.length === 0 && <div className="px-1 text-xs text-zinc-600">nenhum pin</div>}
          {pins.map((p) => (
            <div key={p.id} className="flex items-center gap-2 px-1 py-0.5">
              <input type="checkbox" checked={p.done} onChange={(e) => void toggle(p.id, e.target.checked)} />
              <span className={`flex-1 truncate ${p.done ? 'text-zinc-500 line-through' : ''}`}>{p.text}</span>
              <button onClick={() => void remove(p.id)} className="text-zinc-600 hover:text-red-400">×</button>
            </div>
          ))}
          <form onSubmit={(e) => { e.preventDefault(); void addPin(draft); setDraft('') }} className="mt-1 flex gap-1">
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="+ pin" className="flex-1 rounded bg-zinc-800 px-2 py-0.5 text-xs" />
            <button className="rounded bg-sky-700 px-2 text-xs text-white">add</button>
          </form>
        </div>
        <div className="flex min-h-0 flex-1 flex-col p-2">
          <div className="mb-1 text-[10px] uppercase text-zinc-500">Notes</div>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="scratchpad do projeto…" className="min-h-0 flex-1 resize-none rounded bg-zinc-800 p-2 font-mono text-xs" />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Modify `src/renderer/App.tsx`** — Pins button + panel + onPinsChanged

Add `import { PinsPanel } from './ui/PinsPanel'` + `import { usePins } from './store/pinsStore'`. State `const [showPins, setShowPins] = useState(false)`. In the discussions row add `<button onClick={() => setShowPins(true)} className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-200">Pins</button>`. In the boot effect, subscribe to pins:changed: add `const offPins = window.term.onPinsChanged(() => void usePins.getState().refresh())` and include `offPins()` in the cleanup. Render `{showPins && <PinsPanel onClose={() => setShowPins(false)} />}`.

- [ ] **Step 4: Write component test `src/renderer/ui/PinsPanel.browser.test.tsx`**

```tsx
import { render } from 'vitest-browser-react'
import { expect, test, vi, beforeEach } from 'vitest'
import { PinsPanel } from './PinsPanel'
import { usePins } from '../store/pinsStore'

beforeEach(() => {
  ;(window as any).term = { invoke: vi.fn().mockImplementation((ch: string) => ch === 'pins:list' ? Promise.resolve([{ id: 'p1', text: 'fazer X', done: false, createdAt: 1 }]) : ch === 'notes:get' ? Promise.resolve('minhas notas') : Promise.resolve([]) }
  usePins.setState({ pins: [], notes: '' })
})

test('mostra pins e notes', async () => {
  const screen = await render(<PinsPanel onClose={() => {}} />)
  await expect.element(screen.getByText('fazer X')).toBeVisible()
  await expect.element(screen.getByDisplayValue('minhas notas')).toBeVisible()
})
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm run test:unit && npm run test:component && npm run build` → all green.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/store/pinsStore.ts src/renderer/ui/PinsPanel.tsx src/renderer/ui/PinsPanel.browser.test.tsx src/renderer/App.tsx
git commit -m "feat: Pins & Notes panel + store + live pins:changed refresh"
```

---

## Task 7: E2E + final verification

**Files:** `e2e/pins.spec.ts`

- [ ] **Step 1: Create `e2e/pins.spec.ts`**

```ts
import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import which from 'which'

const git = which.sync('git', { nothrow: true })
test.skip(!git, 'git required')
test('adiciona um pin e ele aparece', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'maestro-e2e-'))
  const proj = mkdtempSync(join(tmpdir(), 'maestro-proj-'))
  execFileSync(git!, ['init', '-q'], { cwd: proj })

  const app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`] })
  await app.evaluate(async ({ dialog }, dir) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] }) }, proj)
  const win = await app.firstWindow()
  await win.waitForSelector('text=Layout', { timeout: 20000 })
  await win.getByRole('button', { name: 'Abrir projeto ▾' }).click()
  await win.getByRole('button', { name: 'Abrir pasta…' }).click()
  await win.getByRole('button', { name: 'Pins', exact: true }).click()
  await win.getByPlaceholder('+ pin').fill('revisar PR')
  await win.getByRole('button', { name: 'add', exact: true }).click()
  await expect(win.getByText('revisar PR')).toBeVisible({ timeout: 10000 })
  await app.close()
})
```

- [ ] **Step 2: Build + run E2E**

Run: `npm run build && npm run test:e2e`
Expected: all specs pass (terminal, profiles, discussion, queen, git, files, pins).

- [ ] **Step 3: Final verification**

Run: `npm run typecheck && npm run test:unit && npm run test:component && npm run build && npm run test:e2e`
Expected: typecheck 0; unit all green; component green; build clean; e2e all pass. `git status --porcelain` empty.

- [ ] **Step 4: Commit**

```bash
git add e2e/pins.spec.ts
git commit -m "test: e2e pins panel + final verification"
```

---

## Self-Review (preenchido)

**Cobertura da spec:**
- §3 modelo → T1. §4.1 PinsStore → T2. §4.2 IPC → T4. §4.3 Queen tools → T3. §4.4 reliability → T5. §4.5 UI → T6. ✔
- §5 fluxos → T4 (push on mutate), T6 (live refresh via onPinsChanged), T5 (restart/cascade). §6 erros → T2 (default), T3 (no-proj isError), T4 (no-proj defaults), T5 (cap/cycle guard). §7 testes → T2/T3/T5 (unit), T3 (integration via tools — real client integration is in queen.integration; optional add), T6 (component), T7 (e2e). ✔
- autoRestart persistido (paneConfigSchema) → T1. cascade-kill → T5. Queen pins tools sem trust gate → T3. ✔

**Placeholder scan:** sem TBD/TODO; código completo. (NOTES: tools.test precisa mockar electron-store [PinsStore real]; gridStore.test setState shape inclui campos reais [exited]; remover `removePane` se ficar não-usado — instruções verificáveis.)

**Consistência de tipos:** `Pin/PinsData` (T1) usados em T2(PinsStore)/T3(tools)/T6(store/panel). Canais `pins:*`/`notes:*` (T1 ipc) ↔ handlers (T4) ↔ store invoke (T6) ↔ Queen tools (T3, via PinsStore não IPC). `pins:changed` (T4 emit + preload onPinsChanged) ↔ App subscribe (T6). `autoRestart` (T1 ProfileEntry/PaneConfig) ↔ paneFromProfile (já copia env/color/etc — ADD autoRestart lá? VER nota) ↔ TerminalPane (T5). `nextRestart` (T5) ↔ TerminalPane. `removePaneTree` (T5 gridStore) ↔ AgentTreeView (T5). `PinsStore` (T2) ↔ QueenToolDeps.pins (T3) + RouterDeps.pins (T4) + index wiring (T4). ✔

**Correção/nota:** `paneFromProfile` (App.tsx + queenBridge.ts) deve copiar `autoRestart: p.autoRestart` pro pane, senão `pane.autoRestart` é sempre undefined e o auto-restart nunca dispara. **ADICIONAR no T5** (ou T6): em ambos os `paneFromProfile`, incluir `autoRestart: p.autoRestart`. Incluído como parte do T5 (tocar paneFromProfile junto do autoRestart de TerminalPane).
```
