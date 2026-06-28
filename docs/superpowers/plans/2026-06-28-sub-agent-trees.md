# Sub-agent Trees Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agent hierarchy — terminals carry a `parentId`; a main-process `AgentTree` tracks nodes (open on pty:create, exited on PTY exit, closed on pty:kill); Queen tools `spawn_sub_agent`/`list_agents`/`await_agent` let agents spawn children, query the tree, and wait for completion; parent gets a mailbox message when a child exits; the sidebar renders the tree.

**Architecture:** Reuse the pty:create/pty:kill chokepoint (add `name`/`parentId` to the payload) so `AgentTree` (main) is the source of truth; PtyHostBridge surfaces PTY exits to mark nodes exited + notify parents via the #4 Mailbox. Renderer panes carry `parentId` and inject `MAESTRO_TERMINAL_ID` into pane env; the sidebar builds a tree from panes + per-pane exit status.

**Tech Stack:** existing — zod 4, @modelcontextprotocol/sdk 1.29, React 19 + zustand, vitest + Playwright. No new deps.

**Spec:** `docs/superpowers/specs/2026-06-28-sub-agent-trees-design.md`

---

## File Structure

```
~ src/shared/types.ts          PaneConfig += parentId
~ src/shared/schemas.ts        ptyCreate += name?/parentId?
~ src/shared/ipc.ts            pty:create args += name?/parentId?
+ src/main/queen/agentTree.ts  AgentTree + AgentNode/AgentTreeNode
~ src/main/queen/tools.ts      spawn_sub_agent/list_agents/await_agent (+agentTree dep)
~ src/main/ptyHostBridge.ts    onExit callback
~ src/main/ipcRouter.ts        pty:create→agentTree.open; pty:kill→close
~ src/main/index.ts            construct AgentTree; wire onExit→markExited+mailbox; pass agentTree to tools
~ src/main/queen/queen.integration.test.ts  + list_agents/await_agent
~ src/renderer/store/gridStore.ts   pane.parentId; exited map + setExited
~ src/renderer/term/TerminalPane.tsx pty:exit → setExited
~ src/renderer/queen/queenBridge.ts terminals.spawn parentId + MAESTRO_TERMINAL_ID env
~ src/renderer/App.tsx          paneFromProfile parentId + MAESTRO_TERMINAL_ID env
+ src/renderer/ui/AgentTreeView.tsx  sidebar tree
~ src/renderer/ui/Sidebar.tsx   render AgentTreeView
~ e2e/  (reuse existing terminal spec covers flat sidebar)
```

---

## Task 1: Shared — parentId / name on pane + pty:create

**Files:** `src/shared/types.ts`, `src/shared/schemas.ts`, `src/shared/ipc.ts`; Test `src/shared/queen.subagent.test.ts`

- [ ] **Step 1: `src/shared/types.ts`** — add `parentId?` to `PaneConfig`

Add the field to the existing `PaneConfig` (keep all current fields):
```ts
  parentId?: string
```

- [ ] **Step 2: `src/shared/schemas.ts`** — add `name`/`parentId` to `ptyCreate`

Insert into the existing `ptyCreate` object (before the `.refine(...)`):
```ts
  name: z.string().optional(),
  parentId: z.string().optional(),
```
(The refine for origin/projectRoot stays unchanged.)

- [ ] **Step 3: `src/shared/ipc.ts`** — add `name?`/`parentId?` to the `pty:create` args type

In `IpcRequest['pty:create'].args`, add `name?: string; parentId?: string` to the inline arg type:
```ts
  'pty:create': { args: { id: string; command: string; args?: string[]; cwd: string; env?: Record<string,string>; cols: number; rows: number; origin?: 'user'|'project'; projectRoot?: string; name?: string; parentId?: string }; result: void }
```

- [ ] **Step 4: Write test `src/shared/queen.subagent.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { ptyCreate } from '../shared/schemas'

describe('ptyCreate name/parentId', () => {
  const base = { id: 'a', command: 'bash', cwd: '/x', cols: 80, rows: 24 }
  it('aceita name/parentId opcionais', () => {
    expect(ptyCreate.safeParse({ ...base, name: 'child', parentId: 'p1' }).success).toBe(true)
  })
  it('segue válido sem eles', () => {
    expect(ptyCreate.safeParse(base).success).toBe(true)
  })
})
```
NOTE: path — put the test at `src/shared/queen.subagent.test.ts` and import `from './schemas'` (same dir). Fix the import to `'./schemas'`.

- [ ] **Step 5: Run + typecheck**

Run: `npx vitest run src/shared/queen.subagent.test.ts && npm run typecheck`
Expected: 2 pass; typecheck 0 (parentId is optional everywhere — no break).

- [ ] **Step 6: Commit**

```bash
git add src/shared
git commit -m "feat: parentId/name on pane + pty:create (sub-agent groundwork)"
```

---

## Task 2: AgentTree (main, pure)

**Files:** `src/main/queen/agentTree.ts`; Test `src/main/queen/agentTree.test.ts`

- [ ] **Step 1: Write failing test `src/main/queen/agentTree.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { AgentTree } from './agentTree'

const open = (t: AgentTree, id: string, parentId?: string) => t.open({ id, name: id, command: 'x', parentId })

describe('AgentTree', () => {
  it('tree() monta raízes e filhos', () => {
    const t = new AgentTree(() => 1)
    open(t, 'root'); open(t, 'child', 'root'); open(t, 'gchild', 'child')
    const tree = t.tree()
    expect(tree).toHaveLength(1)
    expect(tree[0].id).toBe('root')
    expect(tree[0].children[0].id).toBe('child')
    expect(tree[0].children[0].children[0].id).toBe('gchild')
  })
  it('pai ausente -> nó vira raiz', () => {
    const t = new AgentTree(() => 1)
    open(t, 'orphan', 'missing')
    expect(t.tree().map((n) => n.id)).toContain('orphan')
  })
  it('markExited marca status + devolve parentId', () => {
    const t = new AgentTree(() => 1)
    open(t, 'root'); open(t, 'child', 'root')
    const r = t.markExited('child', 0)
    expect(r).toEqual({ parentId: 'root' })
    expect(t.get('child')!.status).toBe('exited')
    expect(t.get('child')!.exitCode).toBe(0)
  })
  it('markExited em id inexistente -> null', () => {
    expect(new AgentTree(() => 1).markExited('nope', 1)).toBeNull()
  })
  it('awaitExit resolve já-exited', async () => {
    const t = new AgentTree(() => 1); open(t, 'a'); t.markExited('a', 7)
    await expect(t.awaitExit('a', 1000)).resolves.toEqual({ exitCode: 7 })
  })
  it('awaitExit resolve no exit posterior', async () => {
    const t = new AgentTree(() => 1); open(t, 'a')
    const p = t.awaitExit('a', 1000)
    t.markExited('a', 3)
    await expect(p).resolves.toEqual({ exitCode: 3 })
  })
  it('awaitExit timeout', async () => {
    const t = new AgentTree(() => 1); open(t, 'a')
    await expect(t.awaitExit('a', 10)).resolves.toBe('timeout')
  })
  it('awaitExit id inexistente -> gone', async () => {
    await expect(new AgentTree(() => 1).awaitExit('nope', 10)).resolves.toBe('gone')
  })
  it('close remove o nó', () => {
    const t = new AgentTree(() => 1); open(t, 'a'); t.close('a')
    expect(t.get('a')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to see fail**

Run: `npx vitest run src/main/queen/agentTree.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/main/queen/agentTree.ts`**

```ts
export type AgentStatus = 'running' | 'exited'
export interface AgentNode { id: string; name: string; command: string; parentId?: string; status: AgentStatus; exitCode?: number; createdAt: number }
export interface AgentTreeNode extends AgentNode { children: AgentTreeNode[] }
export type AwaitResult = { exitCode: number } | 'timeout' | 'gone'

export class AgentTree {
  private nodes = new Map<string, AgentNode>()
  private waiters = new Map<string, ((r: AwaitResult) => void)[]>()
  constructor(private now: () => number = () => Date.now()) {}

  open(n: { id: string; name: string; command: string; parentId?: string }): void {
    this.nodes.set(n.id, { id: n.id, name: n.name, command: n.command, parentId: n.parentId, status: 'running', createdAt: this.now() })
  }

  close(id: string): void {
    this.nodes.delete(id)
    const w = this.waiters.get(id)
    if (w) { for (const r of w) r('gone'); this.waiters.delete(id) }
  }

  markExited(id: string, code: number): { parentId?: string } | null {
    const n = this.nodes.get(id)
    if (!n) return null
    n.status = 'exited'; n.exitCode = code
    const w = this.waiters.get(id)
    if (w) { for (const r of w) r({ exitCode: code }); this.waiters.delete(id) }
    return { parentId: n.parentId }
  }

  get(id: string): AgentNode | undefined { return this.nodes.get(id) }

  tree(): AgentTreeNode[] {
    const ids = new Set(this.nodes.keys())
    const byParent = new Map<string | undefined, AgentNode[]>()
    for (const n of this.nodes.values()) {
      const key = n.parentId && ids.has(n.parentId) ? n.parentId : undefined
      const list = byParent.get(key) ?? []
      list.push(n); byParent.set(key, list)
    }
    const visited = new Set<string>()
    const build = (n: AgentNode): AgentTreeNode => {
      if (visited.has(n.id)) return { ...n, children: [] }
      visited.add(n.id)
      return { ...n, children: (byParent.get(n.id) ?? []).map(build) }
    }
    return (byParent.get(undefined) ?? []).map(build)
  }

  awaitExit(id: string, timeoutMs: number): Promise<AwaitResult> {
    const n = this.nodes.get(id)
    if (!n) return Promise.resolve('gone')
    if (n.status === 'exited') return Promise.resolve({ exitCode: n.exitCode ?? 0 })
    return new Promise<AwaitResult>((resolve) => {
      const timer = setTimeout(() => resolve('timeout'), timeoutMs)
      const wrap = (r: AwaitResult) => { clearTimeout(timer); resolve(r) }
      const list = this.waiters.get(id) ?? []
      list.push(wrap); this.waiters.set(id, list)
    })
  }
}
```

- [ ] **Step 4: Run to see pass**

Run: `npx vitest run src/main/queen/agentTree.test.ts` → 9 PASS. `npm run typecheck` → 0.

- [ ] **Step 5: Commit**

```bash
git add src/main/queen/agentTree.ts src/main/queen/agentTree.test.ts
git commit -m "feat: AgentTree (nodes, tree(), markExited, awaitExit)"
```

---

## Task 3: Queen tools — spawn_sub_agent / list_agents / await_agent

**Files:** `src/main/queen/tools.ts`; Test `src/main/queen/tools.test.ts` (extend)

- [ ] **Step 1: Extend `QueenToolDeps` + register 3 tools in `src/main/queen/tools.ts`**

Add to `QueenToolDeps`:
```ts
  agentTree: import('./agentTree').AgentTree
```
(Prefer a top import: `import type { AgentTree } from './agentTree'` then `agentTree: AgentTree`.)

Register after `project_info` (raw zod shapes; trust gate on spawn_sub_agent):
```ts
  reg('spawn_sub_agent', { title: 'Spawn sub-agent', description: 'Spawn a child terminal under a parent agent (use your own MAESTRO_TERMINAL_ID as parentId)', inputSchema: { parentId: z.string(), profileId: z.string().optional(), command: z.string().optional(), name: z.string().optional() } },
    async (a) => { if (!trusted()) return trustErr(); return json(await deps.bridge.request('terminals.spawn', { profileId: a.profileId, command: a.command, name: a.name, parentId: a.parentId })) })

  reg('list_agents', { title: 'List agents', description: 'Get the agent/terminal hierarchy (tree)', inputSchema: {} },
    () => json(deps.agentTree.tree()))

  reg('await_agent', { title: 'Await agent', description: 'Wait until an agent (terminal) exits; returns exit code and recent output', inputSchema: { id: z.string(), timeoutMs: z.number().int().positive().optional() } },
    async (a) => {
      const r = await deps.agentTree.awaitExit(a.id as string, (a.timeoutMs as number) ?? 120_000)
      if (r === 'timeout') return err('timeout waiting for agent')
      if (r === 'gone') return err('agent not found')
      let output = ''
      try { output = String(await deps.bridge.request('terminals.read', { id: a.id })) } catch { /* best-effort */ }
      return json({ exitCode: r.exitCode, output })
    })
```
(Now 16 tools total.)

- [ ] **Step 2: Extend `src/main/queen/tools.test.ts`** — add deps.agentTree + 3 tests

In the test's `deps()` helper add:
```ts
    agentTree: new (await import('./agentTree')).AgentTree(() => 1),
```
WAIT — `deps()` is sync. Instead import at top: `import { AgentTree } from './agentTree'` and add `agentTree: new AgentTree(() => 1)` to the returned object. Then update the "13 tools" assertion to **16**, and add:
```ts
  it('list_agents devolve a árvore', () => {
    const mcp = new McpServer({ name: 't', version: '1' })
    const d = deps(); d.agentTree.open({ id: 'r', name: 'r', command: 'x' })
    const handlers = registerQueenTools(mcp, d)
    const r = handlers['list_agents']({})
    expect((r as { content: { text: string }[] }).content[0].text).toContain('"id":"r"')
  })
  it('spawn_sub_agent passa parentId pro bridge', async () => {
    const mcp = new McpServer({ name: 't', version: '1' })
    const d = deps(); const handlers = registerQueenTools(mcp, d)
    await handlers['spawn_sub_agent']({ parentId: 'p1', profileId: 'claude' })
    expect(d.bridge.request).toHaveBeenCalledWith('terminals.spawn', { profileId: 'claude', command: undefined, name: undefined, parentId: 'p1' })
  })
  it('await_agent resolve no exit', async () => {
    const mcp = new McpServer({ name: 't', version: '1' })
    const d = deps(); d.agentTree.open({ id: 'a', name: 'a', command: 'x' })
    ;(d.bridge.request as ReturnType<typeof vi.fn>).mockResolvedValue('out')
    const handlers = registerQueenTools(mcp, d)
    const p = handlers['await_agent']({ id: 'a' })
    d.agentTree.markExited('a', 0)
    const r = await p
    expect((r as { content: { text: string }[] }).content[0].text).toContain('"exitCode":0')
  })
```
Update the existing `expect(Object.keys(handlers).length).toBe(13)` → `toBe(16)`.

- [ ] **Step 3: Run + typecheck**

Run: `npx vitest run src/main/queen/tools.test.ts && npm run typecheck`
Expected: all tools tests pass (now ~9); typecheck 0.

- [ ] **Step 4: Commit**

```bash
git add src/main/queen/tools.ts src/main/queen/tools.test.ts
git commit -m "feat: Queen tools spawn_sub_agent / list_agents / await_agent"
```

---

## Task 4: Main wiring — ptyHostBridge onExit + ipcRouter + index + integration

**Files:** `src/main/ptyHostBridge.ts`, `src/main/ipcRouter.ts`, `src/main/index.ts`, `src/main/queen/queen.integration.test.ts`

- [ ] **Step 1: `src/main/ptyHostBridge.ts`** — add an `onExit` callback

The bridge already receives `{type:'exit',id,code,reason}` from the utilityProcess before forwarding to the renderer. Add an optional exit listener. Add a field + setter and call it in the message handler. Concretely: add a constructor-or-setter `onExit?: (id: string, code: number) => void`. Simplest: add a public property:
```ts
  onExit: ((id: string, code: number) => void) | null = null
```
In the `this.proc.on('message', (m: OutMsg) => {...})` handler, in the `m.type === 'exit'` branch, BEFORE/AFTER forwarding to webContents, call: `this.onExit?.(m.id, m.code)`.

- [ ] **Step 2: `src/main/ipcRouter.ts`** — record nodes on pty:create / remove on pty:kill

Add `agentTree: import('./queen/agentTree').AgentTree` to `RouterDeps` (prefer top `import type { AgentTree } from './queen/agentTree'`). In the `pty:create` handler, after the trust check and `deps.ptyHost.spawn(a)`, add:
```ts
    deps.agentTree.open({ id: a.id, name: a.name ?? a.command, command: a.command, parentId: a.parentId })
```
In the `pty:kill` handler:
```ts
  handle('pty:kill', (a) => { deps.ptyHost.kill(a.id); deps.agentTree.close(a.id) })
```

- [ ] **Step 3: `src/main/index.ts`** — construct AgentTree, wire onExit, pass to deps

Add `import { AgentTree } from './queen/agentTree'`. After `mailbox` is constructed:
```ts
const agentTree = new AgentTree()
ptyHost.onExit = (id, code) => {
  const r = agentTree.markExited(id, code)
  if (r?.parentId) mailbox.send({ from: 'system', to: r.parentId, text: `agent ${id} exited (code ${code})` })
}
```
Add `agentTree` to the `startQueen({...})` deps object and to `registerIpc({...})` deps.

- [ ] **Step 4: `src/main/queen/queen.integration.test.ts`** — add list_agents + await_agent

In the `deps()` helper add `agentTree: new AgentTree(() => 1)` (import `AgentTree` at top), and pre-open a node: actually do it inside the test. Add a test:
```ts
  it('list_agents + await_agent via client', async () => {
    const d = deps()
    d.agentTree.open({ id: 'root', name: 'root', command: 'x' })
    const auth = new QueenAuth('tok')
    const h = await startQueen(d, auth)
    try {
      const { client, transport } = await connect(h.url, 'tok')
      const list = await client.callTool({ name: 'list_agents', arguments: {} })
      expect((list.content as { text: string }[])[0].text).toContain('root')
      const p = client.callTool({ name: 'await_agent', arguments: { id: 'root', timeoutMs: 5000 } })
      d.agentTree.markExited('root', 0)
      const r = await p
      expect((r.content as { text: string }[])[0].text).toContain('"exitCode":0')
      await transport.close()
    } finally { await h.close() }
  })
```
(`bridge.request` in deps is a vi.fn; await_agent's terminals.read read will resolve to whatever the fn returns — make the deps `bridge.request` a `vi.fn().mockResolvedValue('')` so the read doesn't reject. Adjust the deps() helper's bridge accordingly.)

- [ ] **Step 5: Typecheck + unit + build**

Run: `npm run typecheck && npm run test:unit && npm run build`
Expected: typecheck 0; all unit green (incl. new integration test); build clean.

- [ ] **Step 6: Commit**

```bash
git add src/main/ptyHostBridge.ts src/main/ipcRouter.ts src/main/index.ts src/main/queen/queen.integration.test.ts
git commit -m "feat: wire AgentTree (pty:create/kill/exit) + parent mailbox notify + integration"
```

---

## Task 5: Renderer — parentId panes, exit status, env, sidebar tree

**Files:** `src/renderer/store/gridStore.ts`, `src/renderer/term/TerminalPane.tsx`, `src/renderer/queen/queenBridge.ts`, `src/renderer/App.tsx`, `src/renderer/ui/AgentTreeView.tsx`, `src/renderer/ui/Sidebar.tsx`

- [ ] **Step 1: `src/renderer/store/gridStore.ts`** — exited map + setExited

Add to the state interface + store:
```ts
  exited: Record<string, number>
  setExited: (id: string, code: number) => void
```
In the store object: `exited: {},` and `setExited: (id, code) => set((s) => ({ exited: { ...s.exited, [id]: code } })),`. (PaneConfig already has `parentId?` from Task 1; addPane stores it.)

- [ ] **Step 2: `src/renderer/term/TerminalPane.tsx`** — report exit to store AND send name/parentId on pty:create

(a) In the existing `onPtyExit` handler (where it writes the exit banner), add `useGrid.getState().setExited(pane.id, code)`. Import `useGrid` from '../store/gridStore' if not already imported. The handler becomes:
```ts
      cleanupExit = window.term.onPtyExit(pane.id, ({ code, reason }) => {
        useGrid.getState().setExited(pane.id, code)
        term.writeln(`\r\n\x1b[31m[processo terminou code=${code}${reason ? ' ' + reason : ''}]\x1b[0m`)
      })
```
(b) CRITICAL — the existing `window.term.invoke('pty:create', {...})` call must now carry `name` and `parentId` so the main-process AgentTree records them. Add the two fields to that invoke's object:
```ts
      await window.term.invoke('pty:create', {
        id: pane.id, command: pane.command, args: pane.args, cwd: pane.cwd,
        env: pane.env, cols: term.cols, rows: term.rows,
        origin: pane.origin ?? 'user', projectRoot: pane.projectRoot,
        name: pane.name, parentId: pane.parentId,
      })
```
(Keep the existing try/catch around it; only add the `name`/`parentId` fields.)

- [ ] **Step 3: `src/renderer/App.tsx`** — paneFromProfile injects parentId? + MAESTRO_TERMINAL_ID

In `paneFromProfile`, generate the id first, then build env including the terminal id (and existing queenEnv). Replace the body:
```ts
  function paneFromProfile(p: Profile, parentId?: string): PaneConfig {
    const id = uuid()
    const isProject = p.source === 'project'
    return { id, name: p.name, command: p.command, args: p.args, cwd: p.cwd ?? project.currentProject ?? '.', env: { ...queenEnv(), MAESTRO_TERMINAL_ID: id, ...(p.env ?? {}) }, color: p.color, profileId: p.id, origin: isProject ? 'project' : 'user', projectRoot: project.currentProject ?? undefined, parentId }
  }
```
(autoStart effect + pickProfile call `paneFromProfile(p)` with no parentId — fine, optional.)

- [ ] **Step 4: `src/renderer/queen/queenBridge.ts`** — terminals.spawn parentId + env

In its `paneFromProfile`, mirror App: add `parentId?: string` param, generate id first, env `{ ...queenEnv(), MAESTRO_TERMINAL_ID: id, ...(p.env ?? {}) }`, set `parentId`. In the `terminals.spawn` case, read `a.parentId` and pass it: profile branch `paneFromProfile(prof, proj.currentProject, a.parentId)` — adjust signature to `paneFromProfile(p, projectRoot, parentId?)`. For the raw-command branch, set `parentId: a.parentId` and `env: { ...queenEnv(), MAESTRO_TERMINAL_ID: id }` (generate id first there too). Update the `terminals.spawn` args type to include `parentId?: string`.

- [ ] **Step 5: Create `src/renderer/ui/AgentTreeView.tsx`**

```tsx
import { useGrid } from '../store/gridStore'
import type { PaneConfig } from '@shared/types'

export function AgentTreeView() {
  const panes = useGrid((s) => s.panes)
  const exited = useGrid((s) => s.exited)
  const active = useGrid((s) => s.activePaneId)
  const setActive = useGrid((s) => s.setActive)
  const removePane = useGrid((s) => s.removePane)

  const ids = new Set(panes.map((p) => p.id))
  const childrenOf = (pid: string | undefined) => panes.filter((p) => (p.parentId && ids.has(p.parentId) ? p.parentId : undefined) === pid)

  const visited = new Set<string>()
  const row = (p: PaneConfig, depth: number) => {
    if (visited.has(p.id)) return null
    visited.add(p.id)
    const done = p.id in exited
    return (
      <div key={p.id}>
        <div onClick={() => setActive(p.id)}
          className={`flex items-center gap-2 rounded px-2 py-1 ${active === p.id ? 'bg-zinc-800' : ''}`}
          style={{ paddingLeft: 8 + depth * 14 }}>
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: done ? '#52525b' : (p.color ?? '#3fb950') }} title={done ? `exited ${exited[p.id]}` : 'running'} />
          <span className="flex-1 truncate">{p.name}</span>
          <button onClick={(e) => { e.stopPropagation(); removePane(p.id); void window.term.invoke('pty:kill', { id: p.id }) }} className="text-zinc-500 hover:text-red-400">×</button>
        </div>
        {childrenOf(p.id).map((c) => row(c, depth + 1))}
      </div>
    )
  }

  return (
    <aside className="w-56 shrink-0 overflow-auto border-r border-zinc-800 p-2 text-sm">
      <div className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Agentes</div>
      {panes.length === 0 && <div className="text-xs text-zinc-600">nenhum terminal</div>}
      {childrenOf(undefined).map((p) => row(p, 0))}
    </aside>
  )
}
```

- [ ] **Step 6: `src/renderer/ui/Sidebar.tsx`** — render AgentTreeView

Replace the Sidebar body with a re-export/delegate to keep App's import stable:
```tsx
import { AgentTreeView } from './AgentTreeView'
export function Sidebar() { return <AgentTreeView /> }
```

- [ ] **Step 7: Typecheck + tests + build**

Run: `npm run typecheck && npm run test:unit && npm run test:component && npm run build`
Expected: all green. (Existing Sidebar usage in App unchanged — it still imports `Sidebar`.)

- [ ] **Step 8: Commit**

```bash
git add src/renderer
git commit -m "feat: renderer sub-agent tree (parentId panes, exit status, env id, sidebar tree)"
```

---

## Task 6: Component test + E2E + final verification

**Files:** `src/renderer/ui/AgentTreeView.browser.test.tsx`; final verification

- [ ] **Step 1: Write component test `src/renderer/ui/AgentTreeView.browser.test.tsx`**

```tsx
import { render } from 'vitest-browser-react'
import { expect, test, beforeEach } from 'vitest'
import { AgentTreeView } from './AgentTreeView'
import { useGrid } from '../store/gridStore'

beforeEach(() => useGrid.setState({
  activeLayout: 'two', activePaneId: null, exited: { c1: 0 },
  panes: [
    { id: 'p1', name: 'Parent', command: 'claude', cwd: '.' },
    { id: 'c1', name: 'Child', command: 'codex', cwd: '.', parentId: 'p1' },
  ],
}))

test('mostra pai e filho (indentado) + status', async () => {
  const screen = await render(<AgentTreeView />)
  await expect.element(screen.getByText('Parent')).toBeVisible()
  await expect.element(screen.getByText('Child')).toBeVisible()
})
```

- [ ] **Step 2: Run component test**

Run: `npm run test:component` → all green (incl. AgentTreeView). Adjust selectors only if markup differs.

- [ ] **Step 3: Final verification**

Run: `npm run typecheck && npm run test:unit && npm run test:component && npm run build && npm run test:e2e`
Expected: typecheck 0; unit all green; component green; build clean; all e2e specs pass (the existing terminal/profiles/discussion/queen specs still pass — Sidebar now renders the tree but still lists terminals, so any spec asserting a terminal name in the sidebar still works). `git status --porcelain` empty.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/ui/AgentTreeView.browser.test.tsx
git commit -m "test: AgentTreeView component test + final verification"
```

---

## Self-Review (preenchido)

**Cobertura da spec:**
- §3 modelo → T1 (parentId/name), T2 (AgentNode/AgentTreeNode). §4.1 AgentTree → T2. §4.2 wiring → T4. §4.3 Queen tools → T3. §4.4 bridge parentId → T5. §4.5 renderer → T5. §4.6 UI → T5 (AgentTreeView). ✔
- §5 fluxos → T4 (open/exit/mailbox), T3 (await). §6 erros → T2 (gone/timeout/null, cycle guard), T3 (await_agent err), T4 (markExited no-op). §7 testes → T2/T3 (unit), T4 (integration), T5/T6 (component), T6 (e2e). ✔
- env MAESTRO_TERMINAL_ID → T5. trust gate spawn_sub_agent → T3. parent notify → T4. ✔

**Placeholder scan:** sem TBD/TODO; código completo. (NOTES sobre import path do teste em T1 e o ajuste do bridge.request mock em T4 são instruções, não placeholders.)

**Consistência de tipos:** `AgentTree`/`AgentNode`/`AgentTreeNode`/`AwaitResult` (T2) usados em T3 (tools dep), T4 (wiring/integration). `pty:create` +name/parentId (T1) ↔ ipcRouter open (T4) ↔ TerminalPane invoke (já passa pane fields; precisa passar name/parentId — VER nota) ↔ paneFromProfile parentId (T5). **NOTA crítica:** TerminalPane's `pty:create` call deve incluir `name: pane.name` e `parentId: pane.parentId` — adicionar isso no T5 Step 2 (o handler de pty:create no TerminalPane). Sem isso, o AgentTree não recebe name/parentId. → AJUSTE T5: ao tocar TerminalPane, no `window.term.invoke('pty:create', {...})` existente, adicionar `name: pane.name, parentId: pane.parentId`.
- `spawn_sub_agent` bridge call shape (T3) ↔ queenBridge terminals.spawn parentId (T5). `setExited`/`exited` (T5 store) ↔ TerminalPane (T5) ↔ AgentTreeView (T5). ✔

**Correção aplicada (T5):** incluir `name: pane.name, parentId: pane.parentId` no `pty:create` do TerminalPane (senão o AgentTree no main recebe name/parentId undefined). Adicionado como parte do T5 Step 2.
