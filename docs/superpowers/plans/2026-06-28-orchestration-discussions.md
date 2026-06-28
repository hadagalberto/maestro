# Orchestration / Discussions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Multi-agent discussions: an orchestrator CLI drives ≥2 participant CLIs through template-driven phases (decision/brainstorm/review/plan/dev-squad/custom), each turn a one-shot headless invocation, producing a live transcript + structured summary cards; autonomous or interactive; gated by workspace trust.

**Architecture:** A pure async-generator engine (`runDiscussion`) walks a data-driven `FlowSpec`, calling an injected `AgentAdapter` per turn and yielding events — deterministic under a `MockAdapter`. The production `CliAdapter` (utilityProcess) maps each profile to a headless one-shot run captured via `captureOnce` (child_process pipes, abort/timeout/tree-kill). A `DiscussionRunner` (main) runs the engine, persists to a `DiscussionStore`, pushes events per discussion, and enforces the #2 trust gate. Renderer adds a New Discussion modal, live discussion view, and list.

**Tech Stack:** node:child_process (pipes) + strip-ansi, zod 4, electron-store 11, React 19 + zustand 5 + Tailwind 4, vitest (+Browser Mode) + Playwright.

**Spec:** `docs/superpowers/specs/2026-06-28-orchestration-discussions-design.md`

---

## File Structure

```
+ src/shared/discussion/types.ts        FlowSpec/Phase/Turn/Event/Adapter/Discussion/DiscussInvoke
+ src/shared/discussion/templates.ts    assignRoles + buildFlow (6 templates) + PromptTemplates
+ src/shared/discussion/engine.ts       runDiscussion async generator + card parsing helpers
+ src/shared/discussion/mockAdapter.ts  MockAdapter (test double; also used by e2e? no — tests only)
~ src/shared/types.ts                   ProfileEntry += discuss?: DiscussInvoke
~ src/shared/schemas.ts                 discussInvoke; discussionInput/summaryCard schemas; channels
~ src/shared/ipc.ts                     discussion:* channels + discussion:event:<id> + DiscussionState
~ src/shared/presets.ts                 discuss defaults
+ src/main/discussion/captureOnce.ts    spawn pipes + abort/timeout/tree-kill
+ src/main/discussion/cliAdapter.ts     AgentAdapter via captureOnce
+ src/main/discussion/discussionStore.ts electron-store maestro-discussions
+ src/main/discussion/discussionRunner.ts run engine, persist, push, trust gate, abort
~ src/main/ipcRouter.ts                  discussion:* handlers
~ src/main/index.ts                      wire runner; abort on quit
~ src/preload/index.ts                   onDiscussionEvent(id, cb)
+ src/renderer/store/discussionStore.ts
+ src/renderer/ui/NewDiscussionModal.tsx
+ src/renderer/ui/DiscussionView.tsx
+ src/renderer/ui/DiscussionList.tsx
+ src/renderer/ui/DiscussionsButton.tsx
~ src/renderer/App.tsx
+ e2e/fixtures/discuss/maestro.yml
~ e2e/discussion.spec.ts
```

---

## Task 1: Shared discussion types + schemas + presets + deps

**Files:** `package.json`; `src/shared/discussion/types.ts`; `src/shared/types.ts`; `src/shared/schemas.ts`; `src/shared/ipc.ts`; `src/shared/presets.ts`; Test `src/shared/discussion/schemas.discussion.test.ts`

- [ ] **Step 1: Install strip-ansi**

Run: `npm install strip-ansi@^7.1.0`
Expected: adds `strip-ansi` to dependencies.

- [ ] **Step 2: Create `src/shared/discussion/types.ts`**

```ts
import type { ProfileEntry } from '../types'

export type TemplateKind = 'decision' | 'brainstorm' | 'review' | 'plan' | 'dev-squad' | 'custom'
export type CardKind = 'decision' | 'ideas' | 'verdict' | 'plan' | 'status' | 'note'

export interface Participant { id: string; role: string; profileId: string }

export type SpeakerSelector =
  | { kind: 'all' }
  | { kind: 'roles'; roles: string[] }
  | { kind: 'orchestrator' }

export interface Turn {
  id: string; phaseId: string; round: number
  participantId: string; role: string
  text: string; createdAt: number; isSynthesis: boolean
  error?: string
}

export interface PromptContext {
  topic: string; phase: string; round: number; role: string
  transcript: Turn[]; priorSynthesis?: string
}
export type PromptTemplate = (ctx: PromptContext) => { system?: string; prompt: string }

export interface SynthesisSpec { template: PromptTemplate; card: CardKind }
export interface Phase {
  id: string; label: string
  speakers: SpeakerSelector
  template: PromptTemplate
  mode: 'parallel' | 'sequential'
  repeat?: { until: 'maxRounds' | 'converged'; max: number }
  synthesize?: SynthesisSpec
  gate?: 'auto' | 'approval'
}
export interface FlowSpec { id: string; kind: TemplateKind; phases: Phase[]; maxRounds: number; windowTurns: number }

export interface SummaryCard {
  kind: CardKind; title: string; body: string
  dissents?: string[]
  actions?: { owner?: string; task: string }[]
}

export type DiscussionStatus = 'running' | 'awaiting-approval' | 'done' | 'error' | 'aborted'

export interface Discussion {
  id: string; topic: string; templateKind: TemplateKind
  orchestratorProfileId: string; participants: Participant[]
  autonomous: boolean; status: DiscussionStatus
  transcript: Turn[]; cards: SummaryCard[]
  createdAt: number; updatedAt: number; projectRoot: string | null
}

export type DiscussionEvent =
  | { type: 'phase-start'; phaseId: string; round: number }
  | { type: 'turn-start'; turn: Pick<Turn, 'id' | 'phaseId' | 'participantId' | 'role' | 'round'> }
  | { type: 'turn-delta'; turnId: string; text: string }
  | { type: 'turn-end'; turn: Turn }
  | { type: 'synthesis'; turn: Turn }
  | { type: 'card'; card: SummaryCard }
  | { type: 'round-boundary'; round: number }
  | { type: 'awaiting-approval'; phaseId: string }
  | { type: 'status'; status: DiscussionStatus }
  | { type: 'error'; message: string; turnId?: string }

export interface DiscussionResult { transcript: Turn[]; cards: SummaryCard[]; rounds: number; status: DiscussionStatus }

// adapter boundary (only impure surface)
export type AgentChunk = { type: 'delta'; text: string } | { type: 'final'; text: string } | { type: 'error'; message: string }
export interface AgentTurnRequest { participantId: string; profileId: string; system?: string; prompt: string; cwd: string; signal: AbortSignal }
export interface AgentAdapter { run(req: AgentTurnRequest): AsyncIterable<AgentChunk> }

// engine deps + input
export interface RunDeps { adapter: AgentAdapter; now: () => number; ids: () => string; signal: AbortSignal }
export interface DiscussionInput { topic: string; flow: FlowSpec; participants: Participant[]; orchestrator: Participant; autonomous: boolean }

// per-profile headless invocation config
export interface DiscussInvoke {
  argsTemplate: string[]      // '{{prompt}}' placeholder replaced; if absent & stdin, prompt via stdin
  stdin?: boolean
  captureMode?: 'pipe' | 'pty'
  timeoutMs?: number
}
export type { ProfileEntry }
```

- [ ] **Step 3: Extend `src/shared/types.ts` — add `discuss` to `ProfileEntry`**

Add the field to the existing `ProfileEntry` interface (keep all current fields):
```ts
export interface ProfileEntry {
  name?: string
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  autoStart?: boolean
  color?: string
  disabled?: boolean
  discuss?: { argsTemplate: string[]; stdin?: boolean; captureMode?: 'pipe' | 'pty'; timeoutMs?: number }
}
```

- [ ] **Step 4: Extend `src/shared/schemas.ts`** (add after existing schemas; also add `discuss` to `profileEntrySchema`)

Add `discuss` to `profileEntrySchema` (insert the field into the existing `z.object({...})`):
```ts
  discuss: z.object({
    argsTemplate: z.array(z.string()),
    stdin: z.boolean().optional(),
    captureMode: z.enum(['pipe', 'pty']).optional(),
    timeoutMs: z.number().int().positive().optional(),
  }).optional(),
```
Then append:
```ts
export const summaryCardSchema = z.object({
  kind: z.enum(['decision', 'ideas', 'verdict', 'plan', 'status', 'note']),
  title: z.string(),
  body: z.string(),
  dissents: z.array(z.string()).optional(),
  actions: z.array(z.object({ owner: z.string().optional(), task: z.string() })).optional(),
})

export const discussionInput = z.object({
  topic: z.string().min(1),
  templateKind: z.enum(['decision', 'brainstorm', 'review', 'plan', 'dev-squad', 'custom']),
  orchestratorProfileId: z.string().min(1),
  participantProfileIds: z.array(z.string().min(1)).min(2),
  autonomous: z.boolean(),
})

export const discussionId = z.object({ id: z.string().min(1) })
export const discussionApprove = z.object({ id: z.string().min(1), approve: z.boolean() })
```
And add to `schemaByChannel`:
```ts
  'discussion:start': discussionInput,
  'discussion:get': discussionId,
  'discussion:abort': discussionId,
  'discussion:delete': discussionId,
  'discussion:approve': discussionApprove,
```

- [ ] **Step 5: Extend `src/shared/ipc.ts`** — add channels + per-id event + DiscussionSummary

Add imports `Discussion, DiscussionEvent, TemplateKind` from `./discussion/types`. Append to `IpcRequest`:
```ts
  'discussion:start': { args: { topic: string; templateKind: TemplateKind; orchestratorProfileId: string; participantProfileIds: string[]; autonomous: boolean }; result: { id: string } }
  'discussion:list': { args: undefined; result: Discussion[] }
  'discussion:get': { args: { id: string }; result: Discussion | null }
  'discussion:abort': { args: { id: string }; result: void }
  'discussion:delete': { args: { id: string }; result: void }
  'discussion:approve': { args: { id: string; approve: boolean }; result: void }
```
Add the per-id discussion event channel + payload:
```ts
export const discussionEventChannel = (id: string) => `discussion:event:${id}` as const
export interface IpcEventById { 'discussion:event': DiscussionEvent }
export type { Discussion, DiscussionEvent, TemplateKind }
```
(`schemaByChannel` already validates the request channels; `discussion:list` has no args schema — handled like `config:get`.)

- [ ] **Step 6: Extend `src/shared/presets.ts`** — add `discuss` defaults

```ts
import type { ProfileEntry } from './types'

const oneShot = (args: string[]): ProfileEntry['discuss'] => ({ argsTemplate: args })

export const PROFILE_PRESETS: Record<string, ProfileEntry> = {
  claude:   { command: 'claude',   args: [], color: '#d97757', discuss: oneShot(['-p', '{{prompt}}']) },
  codex:    { command: 'codex',    args: [], color: '#10a37f', discuss: oneShot(['exec', '{{prompt}}']) },
  gemini:   { command: 'gemini',   args: [], color: '#4285f4', discuss: oneShot(['-p', '{{prompt}}']) },
  opencode: { command: 'opencode', args: [], color: '#f59e0b', discuss: oneShot(['-p', '{{prompt}}']) },
  amp:      { command: 'amp',      args: [], color: '#8b5cf6', discuss: oneShot(['-p', '{{prompt}}']) },
  shell: {
    command: process.platform === 'win32' ? 'powershell.exe' : 'bash',
    args: [], color: '#6e7681',
  },
}
```

- [ ] **Step 7: Write failing test `src/shared/discussion/schemas.discussion.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { discussionInput, summaryCardSchema, profileEntrySchema } from '../schemas'

describe('discussionInput', () => {
  it('exige >=2 participantes', () => {
    expect(discussionInput.safeParse({ topic: 't', templateKind: 'decision', orchestratorProfileId: 'c', participantProfileIds: ['a'], autonomous: true }).success).toBe(false)
    expect(discussionInput.safeParse({ topic: 't', templateKind: 'decision', orchestratorProfileId: 'c', participantProfileIds: ['a', 'b'], autonomous: true }).success).toBe(true)
  })
})
describe('summaryCardSchema', () => {
  it('valida card com dissents/actions', () => {
    expect(summaryCardSchema.safeParse({ kind: 'decision', title: 'x', body: 'y', dissents: ['z'], actions: [{ task: 'do' }] }).success).toBe(true)
  })
  it('rejeita kind inválido', () => {
    expect(summaryCardSchema.safeParse({ kind: 'bogus', title: 'x', body: 'y' }).success).toBe(false)
  })
})
describe('profileEntrySchema discuss', () => {
  it('aceita discuss opcional', () => {
    expect(profileEntrySchema.safeParse({ command: 'claude', discuss: { argsTemplate: ['-p', '{{prompt}}'] } }).success).toBe(true)
  })
})
```

- [ ] **Step 8: Run test + typecheck**

Run: `npx vitest run src/shared/discussion/schemas.discussion.test.ts` → PASS. Then `npm run typecheck`. NOTE: existing presets.test or other tests don't exist for presets; gemini preset is new (fine). The renderer/main still compile (discuss is optional). Expected typecheck 0. If `ipc.ts` import of `discussion/types` creates a cycle warning, it's types-only (fine).

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json src/shared
git commit -m "feat: discussion shared types/schemas/presets + strip-ansi dep"
```

---

## Task 2: Templates — assignRoles + buildFlow

**Files:** `src/shared/discussion/templates.ts`; Test `src/shared/discussion/templates.test.ts`

- [ ] **Step 1: Write failing test `src/shared/discussion/templates.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { assignRoles, buildFlow } from './templates'

describe('assignRoles', () => {
  it('decision: pro/con + panelist', () => {
    expect(assignRoles('decision', ['a', 'b', 'c']).map((p) => p.role)).toEqual(['pro', 'con', 'panelist'])
  })
  it('review: defender/attacker', () => {
    expect(assignRoles('review', ['a', 'b']).map((p) => p.role)).toEqual(['defender', 'attacker'])
  })
  it('brainstorm: todos ideator', () => {
    expect(assignRoles('brainstorm', ['a', 'b']).every((p) => p.role === 'ideator')).toBe(true)
  })
  it('dev-squad: builder-N', () => {
    expect(assignRoles('dev-squad', ['a', 'b']).map((p) => p.role)).toEqual(['builder-1', 'builder-2'])
  })
})

describe('buildFlow', () => {
  it('decision tem fase de diverge, rebut (repeat) e decisão (synthesize decision)', () => {
    const flow = buildFlow('decision', assignRoles('decision', ['a', 'b']))
    expect(flow.kind).toBe('decision')
    expect(flow.phases.some((p) => p.synthesize?.card === 'decision')).toBe(true)
    expect(flow.phases.some((p) => p.repeat)).toBe(true)
  })
  it('plan: product+eng paralelo e synthesize plan', () => {
    const flow = buildFlow('plan', assignRoles('plan', ['a', 'b']))
    expect(flow.phases.some((p) => p.synthesize?.card === 'plan')).toBe(true)
  })
  it('custom: fase all + synthesize note', () => {
    const flow = buildFlow('custom', assignRoles('custom', ['a', 'b']))
    expect(flow.phases.length).toBeGreaterThanOrEqual(2)
  })
})
```

- [ ] **Step 2: Run to see fail**

Run: `npx vitest run src/shared/discussion/templates.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `src/shared/discussion/templates.ts`**

```ts
import type { FlowSpec, Participant, Phase, PromptContext, PromptTemplate, TemplateKind } from './types'

let _seq = 0
function pid(profileId: string, i: number): string { return `${profileId}#${i}#${_seq++}` }

export function assignRoles(kind: TemplateKind, profileIds: string[]): Participant[] {
  const mk = (role: string, i: number): Participant => ({ id: pid(profileIds[i], i), role, profileId: profileIds[i] })
  switch (kind) {
    case 'decision': return profileIds.map((_, i) => mk(i === 0 ? 'pro' : i === 1 ? 'con' : 'panelist', i))
    case 'review': return profileIds.map((_, i) => mk(i === 0 ? 'defender' : i === 1 ? 'attacker' : 'reviewer', i))
    case 'plan': return profileIds.map((_, i) => mk(i === 0 ? 'product' : i === 1 ? 'eng' : 'contributor', i))
    case 'brainstorm': return profileIds.map((_, i) => mk('ideator', i))
    case 'dev-squad': return profileIds.map((_, i) => mk(`builder-${i + 1}`, i))
    default: return profileIds.map((_, i) => mk('participant', i))
  }
}

function recent(ctx: PromptContext, n = 8): string {
  return ctx.transcript.slice(-n).map((t) => `[${t.role}] ${t.text}`).join('\n\n')
}

const NO_CONSENSUS = 'Be specific and concise. Do not invent agreement; state disagreement plainly.'

function divergeTpl(instruction: string): PromptTemplate {
  return (ctx) => ({ system: `You are the "${ctx.role}". ${NO_CONSENSUS}`, prompt: `Topic: ${ctx.topic}\n\n${instruction}` })
}
function rebutTpl(): PromptTemplate {
  return (ctx) => ({ system: `You are the "${ctx.role}". ${NO_CONSENSUS}`, prompt: `Topic: ${ctx.topic}\n\nDiscussion so far:\n${recent(ctx)}\n\nRespond to the other side. Defend or revise your position with reasons.` })
}
function synthCardTpl(kind: string): PromptTemplate {
  return (ctx) => ({
    system: 'You are the orchestrator. Output ONLY a JSON object, no prose.',
    prompt: `Topic: ${ctx.topic}\n\nFull discussion:\n${ctx.transcript.map((t) => `[${t.role}] ${t.text}`).join('\n\n')}\n\nProduce a JSON summary card with this exact shape: {"kind":"${kind}","title":string,"body":string,"dissents":string[],"actions":[{"owner":string,"task":string}]}. Capture the real outcome. List genuine dissent in "dissents"; do NOT manufacture consensus. If converged, you may include the word CONVERGED in body.` })
}

export function buildFlow(kind: TemplateKind, participants: Participant[]): FlowSpec {
  const base = { maxRounds: 3, windowTurns: 12 }
  const roles = (...r: string[]): Phase['speakers'] => ({ kind: 'roles', roles: r })

  switch (kind) {
    case 'decision': return { id: 'decision', kind, ...base, phases: [
      { id: 'diverge', label: 'Posições', speakers: roles('pro', 'con', 'panelist'), template: divergeTpl('State your position on the topic with your strongest arguments.'), mode: 'parallel' },
      { id: 'rebut', label: 'Réplica', speakers: roles('pro', 'con', 'panelist'), template: rebutTpl(), mode: 'sequential', repeat: { until: 'converged', max: 2 } },
      { id: 'decide', label: 'Decisão', speakers: { kind: 'orchestrator' }, template: synthCardTpl('decision'), mode: 'sequential', synthesize: { template: synthCardTpl('decision'), card: 'decision' } },
    ] }
    case 'brainstorm': return { id: 'brainstorm', kind, ...base, phases: [
      { id: 'diverge', label: 'Ideias', speakers: { kind: 'all' }, template: divergeTpl('Brainstorm distinct ideas on the topic. Be original; do not coordinate with others.'), mode: 'parallel' },
      { id: 'cluster', label: 'Síntese', speakers: { kind: 'orchestrator' }, template: synthCardTpl('ideas'), mode: 'sequential', synthesize: { template: synthCardTpl('ideas'), card: 'ideas' } },
    ] }
    case 'review': return { id: 'review', kind, ...base, phases: [
      { id: 'present', label: 'Defesa', speakers: roles('defender'), template: divergeTpl('Present and justify the approach/code under review.'), mode: 'sequential' },
      { id: 'attack', label: 'Crítica', speakers: roles('attacker', 'reviewer'), template: rebutTpl(), mode: 'sequential', repeat: { until: 'maxRounds', max: 2 } },
      { id: 'verdict', label: 'Veredito', speakers: { kind: 'orchestrator' }, template: synthCardTpl('verdict'), mode: 'sequential', synthesize: { template: synthCardTpl('verdict'), card: 'verdict' } },
    ] }
    case 'plan': return { id: 'plan', kind, ...base, phases: [
      { id: 'lenses', label: 'Lentes', speakers: roles('product', 'eng', 'contributor'), template: divergeTpl('Draft the plan from your lens (product or engineering). Note risks.'), mode: 'parallel' },
      { id: 'merge', label: 'Plano', speakers: { kind: 'orchestrator' }, template: synthCardTpl('plan'), mode: 'sequential', synthesize: { template: synthCardTpl('plan'), card: 'plan' } },
    ] }
    case 'dev-squad': return { id: 'dev-squad', kind, ...base, phases: [
      { id: 'split', label: 'Divisão', speakers: { kind: 'orchestrator' }, template: (ctx) => ({ system: 'You are the orchestrator.', prompt: `Topic: ${ctx.topic}\n\nالسplit the work into one task per builder. List tasks clearly.` }), mode: 'sequential' },
      { id: 'build', label: 'Construção', speakers: { kind: 'all' }, template: rebutTpl(), mode: 'parallel' },
      { id: 'integrate', label: 'Integração', speakers: { kind: 'orchestrator' }, template: synthCardTpl('status'), mode: 'sequential', synthesize: { template: synthCardTpl('status'), card: 'status' } },
    ] }
    default: return { id: 'custom', kind: 'custom', ...base, phases: [
      { id: 'respond', label: 'Respostas', speakers: { kind: 'all' }, template: divergeTpl('Respond to the topic.'), mode: 'parallel' },
      { id: 'synth', label: 'Síntese', speakers: { kind: 'orchestrator' }, template: synthCardTpl('note'), mode: 'sequential', synthesize: { template: synthCardTpl('note'), card: 'note' } },
    ] }
  }
}
```
FIX before commit: remove the accidental non-ASCII in the dev-squad split prompt — it must read `Split the work into one task per builder. List tasks clearly.` (no stray characters).

- [ ] **Step 4: Run to see pass**

Run: `npx vitest run src/shared/discussion/templates.test.ts` → PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/discussion/templates.ts src/shared/discussion/templates.test.ts
git commit -m "feat: discussion templates (assignRoles + buildFlow, 6 flows)"
```

---

## Task 3: Engine — runDiscussion + MockAdapter

**Files:** `src/shared/discussion/mockAdapter.ts`; `src/shared/discussion/engine.ts`; Test `src/shared/discussion/engine.test.ts`

- [ ] **Step 1: Create `src/shared/discussion/mockAdapter.ts`**

```ts
import type { AgentAdapter, AgentChunk, AgentTurnRequest } from './types'

// Scripted adapter for deterministic tests. Looks up responses by role, falling back to a default.
export class MockAdapter implements AgentAdapter {
  constructor(private byRole: Record<string, string | string[]>, private dflt = 'ok') {}
  private calls: Record<string, number> = {}
  async *run(req: AgentTurnRequest): AsyncIterable<AgentChunk> {
    const v = this.byRole[req.participantId] ?? this.byRole[reqRole(req)] ?? this.dflt
    const n = this.calls[req.participantId] = (this.calls[req.participantId] ?? 0) + 1
    const text = Array.isArray(v) ? (v[n - 1] ?? v[v.length - 1]) : v
    yield { type: 'final', text }
  }
}
// participantId encodes role via templates' pid? No — role is on the request indirectly. The engine sets req with role omitted.
// To key by role we expose role through a side map; simplest: tests key by participantId. Provide a role-keyed variant:
function reqRole(_req: AgentTurnRequest): string { return '' }
```
NOTE: keep `MockAdapter` keyed by `participantId` (tests build participants and know their ids) — remove the unused `reqRole`/role-fallback if it complicates typecheck; the role-based lookup is optional. SIMPLER VERSION to use:
```ts
import type { AgentAdapter, AgentChunk, AgentTurnRequest } from './types'
export class MockAdapter implements AgentAdapter {
  constructor(private responder: (req: AgentTurnRequest, callIndex: number) => string) {}
  private calls = new Map<string, number>()
  async *run(req: AgentTurnRequest): AsyncIterable<AgentChunk> {
    const n = (this.calls.get(req.participantId) ?? 0) + 1
    this.calls.set(req.participantId, n)
    yield { type: 'final', text: this.responder(req, n) }
  }
}
```
USE THE SIMPLER VERSION (a responder function) — delete the first version. Tests pass a `responder`.

- [ ] **Step 2: Write failing test `src/shared/discussion/engine.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { runDiscussion } from './engine'
import { MockAdapter } from './mockAdapter'
import { assignRoles, buildFlow } from './templates'
import type { DiscussionEvent, DiscussionInput, RunDeps } from './types'

function fixedDeps(responder: (role: string, n: number) => string, signal = new AbortController().signal): RunDeps {
  let i = 0
  return { adapter: new MockAdapter((req, n) => responder(req.role, n)), now: () => 1000, ids: () => `id${i++}`, signal }
}

async function collect(input: DiscussionInput, deps: RunDeps) {
  const events: DiscussionEvent[] = []
  const gen = runDiscussion(input, deps)
  let res = await gen.next()
  while (!res.done) { events.push(res.value); res = await gen.next() }
  return { events, result: res.value }
}

function decisionInput(autonomous = true): DiscussionInput {
  const participants = assignRoles('decision', ['claude', 'codex'])
  const orchestrator = { id: 'orch', role: 'orchestrator', profileId: 'claude' }
  return { topic: 'spaces vs tabs', flow: buildFlow('decision', participants), participants, orchestrator, autonomous }
}

describe('runDiscussion', () => {
  it('roda decision: turnos dos participantes + synthesis + card decision; status done', async () => {
    const { events, result } = await collect(decisionInput(), fixedDeps((role) =>
      role === 'orchestrator' ? '{"kind":"decision","title":"T","body":"spaces win","dissents":["con disagrees"]}' : `pos:${role}`))
    expect(events.some((e) => e.type === 'turn-end')).toBe(true)
    expect(events.some((e) => e.type === 'synthesis')).toBe(true)
    const card = events.find((e) => e.type === 'card') as Extract<DiscussionEvent, { type: 'card' }>
    expect(card.card.kind).toBe('decision')
    expect(card.card.dissents).toContain('con disagrees')
    expect(result.status).toBe('done')
  })

  it('card inválido -> note fallback após re-ask', async () => {
    let orchCalls = 0
    const { events } = await collect(decisionInput(), fixedDeps((role) => {
      if (role === 'orchestrator') { orchCalls++; return 'not json at all' }
      return 'x'
    }))
    const card = events.find((e) => e.type === 'card') as Extract<DiscussionEvent, { type: 'card' }>
    expect(card.card.kind).toBe('note')
    expect(orchCalls).toBeGreaterThanOrEqual(2) // synthesis + 1 re-ask
  })

  it('respeita repeat.max em rebut (não passa de max rodadas)', async () => {
    const { events } = await collect(decisionInput(), fixedDeps((role) => role === 'orchestrator' ? '{"kind":"decision","title":"t","body":"b"}' : 'y'))
    const boundaries = events.filter((e) => e.type === 'round-boundary').length
    expect(boundaries).toBeLessThanOrEqual(3)
  })

  it('abort -> status aborted', async () => {
    const ac = new AbortController(); ac.abort()
    const { result } = await collect(decisionInput(), fixedDeps(() => 'x', ac.signal))
    expect(result.status).toBe('aborted')
  })

  it('gate approval (não autônomo) suspende e resume', async () => {
    const participants = assignRoles('custom', ['a', 'b'])
    const orchestrator = { id: 'orch', role: 'orchestrator', profileId: 'a' }
    const flow = buildFlow('custom', participants)
    flow.phases[0].gate = 'approval'
    const input: DiscussionInput = { topic: 't', flow, participants, orchestrator, autonomous: false }
    const gen = runDiscussion(input, fixedDeps((role) => role === 'orchestrator' ? '{"kind":"note","title":"t","body":"b"}' : 'z'))
    let res = await gen.next(); let sawAwait = false
    while (!res.done) {
      if (res.value.type === 'awaiting-approval') { sawAwait = true; res = await gen.next({ approve: true } as any) }
      else res = await gen.next()
    }
    expect(sawAwait).toBe(true)
    expect(res.value.status).toBe('done')
  })
})
```

- [ ] **Step 3: Run to see fail**

Run: `npx vitest run src/shared/discussion/engine.test.ts` → FAIL (module not found).

- [ ] **Step 4: Implement `src/shared/discussion/engine.ts`**

```ts
import type {
  AgentTurnRequest, DiscussionEvent, DiscussionInput, DiscussionResult,
  Participant, Phase, PromptContext, RunDeps, SummaryCard, Turn,
} from './types'

function resolveSpeakers(phase: Phase, participants: Participant[], orchestrator: Participant): Participant[] {
  const s = phase.speakers
  if (s.kind === 'orchestrator') return [orchestrator]
  if (s.kind === 'all') return participants
  return participants.filter((p) => s.roles.includes(p.role))
}

function buildContext(input: DiscussionInput, phase: Phase, round: number, role: string, transcript: Turn[]): PromptContext {
  const win = transcript.slice(-input.flow.windowTurns)
  const priorSynthesis = [...transcript].reverse().find((t) => t.isSynthesis)?.text
  return { topic: input.topic, phase: phase.id, round, role, transcript: win, priorSynthesis }
}

async function capture(adapter: RunDeps['adapter'], req: AgentTurnRequest): Promise<{ text: string; error?: string }> {
  let text = ''; let error: string | undefined
  try {
    for await (const chunk of adapter.run(req)) {
      if (chunk.type === 'delta') text += chunk.text
      else if (chunk.type === 'final') text = chunk.text
      else if (chunk.type === 'error') error = chunk.message
    }
  } catch (e) { error = e instanceof Error ? e.message : String(e) }
  return { text, error }
}

function extractJson(text: string): unknown | null {
  const start = text.indexOf('{'); const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try { return JSON.parse(text.slice(start, end + 1)) } catch { return null }
}

import { summaryCardSchema } from '../schemas'
function parseCard(text: string, kind: SummaryCard['kind']): SummaryCard | null {
  const obj = extractJson(text)
  if (!obj) return null
  const r = summaryCardSchema.safeParse(obj)
  return r.success ? r.data : null
}
function noteCard(text: string, kind: SummaryCard['kind'], title: string): SummaryCard {
  return { kind, title, body: text.trim() || '(sem conteúdo)' }
}

export async function* runDiscussion(input: DiscussionInput, deps: RunDeps): AsyncGenerator<DiscussionEvent, DiscussionResult> {
  const { adapter, now, ids, signal } = deps
  const transcript: Turn[] = []
  const cards: SummaryCard[] = []
  let rounds = 0

  const finish = (status: DiscussionResult['status']): DiscussionResult => ({ transcript, cards, rounds, status })

  for (const phase of input.flow.phases) {
    if (signal.aborted) return finish('aborted')
    const maxRound = phase.repeat?.max ?? 1

    for (let round = 1; round <= maxRound; round++) {
      if (signal.aborted) return finish('aborted')
      rounds = Math.max(rounds, round)
      yield { type: 'phase-start', phaseId: phase.id, round }

      const speakers = resolveSpeakers(phase, input.participants, input.orchestrator)
      const pending = speakers.map((sp) => ({
        sp,
        turn: { id: ids(), phaseId: phase.id, round, participantId: sp.id, role: sp.role, text: '', createdAt: now(), isSynthesis: false } as Turn,
      }))
      for (const p of pending) yield { type: 'turn-start', turn: { id: p.turn.id, phaseId: p.turn.phaseId, participantId: p.turn.participantId, role: p.turn.role, round: p.turn.round } }

      const runOne = async (p: typeof pending[number]) => {
        const { system, prompt } = phase.template(buildContext(input, phase, round, p.sp.role, transcript))
        const req: AgentTurnRequest = { participantId: p.sp.id, profileId: p.sp.profileId, system, prompt, cwd: '.', signal }
        const r = await capture(adapter, req)
        p.turn.text = r.text; p.turn.error = r.error; p.turn.createdAt = now()
      }
      if (phase.mode === 'parallel') await Promise.all(pending.map(runOne))
      else for (const p of pending) { if (signal.aborted) break; await runOne(p) }

      for (const p of pending) { transcript.push(p.turn); yield { type: 'turn-end', turn: p.turn } }
      yield { type: 'round-boundary', round }

      if (phase.repeat?.until === 'converged') {
        const lastSynth = [...transcript].reverse().find((t) => t.isSynthesis)
        if (lastSynth && /CONVERGED/i.test(lastSynth.text)) break
      }
    }

    if (phase.synthesize) {
      if (signal.aborted) return finish('aborted')
      const synth: Turn = { id: ids(), phaseId: phase.id, round: rounds, participantId: input.orchestrator.id, role: 'orchestrator', text: '', createdAt: now(), isSynthesis: true }
      yield { type: 'turn-start', turn: { id: synth.id, phaseId: synth.phaseId, participantId: synth.participantId, role: synth.role, round: synth.round } }
      const ctx = buildContext(input, phase, rounds, 'orchestrator', transcript)
      const first = phase.synthesize.template(ctx)
      const r1 = await capture(adapter, { participantId: input.orchestrator.id, profileId: input.orchestrator.profileId, system: first.system, prompt: first.prompt, cwd: '.', signal })
      synth.text = r1.text; synth.error = r1.error; synth.createdAt = now()
      transcript.push(synth); yield { type: 'synthesis', turn: synth }

      let card = parseCard(synth.text, phase.synthesize.card)
      if (!card) {
        const r2 = await capture(adapter, { participantId: input.orchestrator.id, profileId: input.orchestrator.profileId, prompt: `${first.prompt}\n\nReturn ONLY the JSON object, nothing else.`, system: first.system, cwd: '.', signal })
        card = parseCard(r2.text, phase.synthesize.card) ?? noteCard(synth.text, phase.synthesize.card === 'decision' ? 'note' : 'note', phase.label)
      }
      cards.push(card); yield { type: 'card', card }
    }

    if (phase.gate === 'approval' && !input.autonomous) {
      const approval = (yield { type: 'awaiting-approval', phaseId: phase.id }) as unknown as { approve: boolean } | undefined
      if (approval && approval.approve === false) return finish('aborted')
    }
  }

  return finish('done')
}
```
NOTE on the note-card fallback: when card parse fails twice, produce a `note` card (kind forced to `'note'`) — that matches the test expecting `kind === 'note'`.

- [ ] **Step 5: Run to see pass**

Run: `npx vitest run src/shared/discussion/engine.test.ts` → PASS (5 tests). Then `npm run typecheck` → 0. (If TS complains the `yield` expression type for approval is `unknown`, the `as unknown as {...}` cast handles it.)

- [ ] **Step 6: Commit**

```bash
git add src/shared/discussion/engine.ts src/shared/discussion/mockAdapter.ts src/shared/discussion/engine.test.ts
git commit -m "feat: discussion engine (pure async generator) + MockAdapter"
```

---

## Task 4: captureOnce (one-shot spawn capture)

**Files:** `src/main/discussion/captureOnce.ts`; Test `src/main/discussion/captureOnce.test.ts`

- [ ] **Step 1: Write failing test `src/main/discussion/captureOnce.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { captureOnce, CaptureError } from './captureOnce'

const node = process.execPath // a real, always-present executable

describe('captureOnce', () => {
  it('captura stdout de um processo real', async () => {
    const r = await captureOnce({ command: node, args: ['-e', "process.stdout.write('hello')"], cwd: process.cwd() })
    expect(r.stdout).toBe('hello')
    expect(r.code).toBe(0)
  })
  it('separa stderr de stdout', async () => {
    const r = await captureOnce({ command: node, args: ['-e', "process.stdout.write('OUT');process.stderr.write('ERR')"], cwd: process.cwd() })
    expect(r.stdout).toBe('OUT'); expect(r.stderr).toBe('ERR')
  })
  it('timeout mata o processo e rejeita', async () => {
    await expect(captureOnce({ command: node, args: ['-e', 'setTimeout(()=>{}, 60000)'], cwd: process.cwd(), timeoutMs: 300 }))
      .rejects.toMatchObject({ reason: 'timeout' })
  })
  it('abort via signal rejeita aborted', async () => {
    const ac = new AbortController()
    const p = captureOnce({ command: node, args: ['-e', 'setTimeout(()=>{}, 60000)'], cwd: process.cwd(), signal: ac.signal })
    setTimeout(() => ac.abort(), 100)
    await expect(p).rejects.toMatchObject({ reason: 'aborted' })
  })
  it('feeds stdin', async () => {
    const r = await captureOnce({ command: node, args: ['-e', "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(d.toUpperCase()))"], cwd: process.cwd(), stdin: 'abc' })
    expect(r.stdout).toBe('ABC')
  })
})
```
NOTE: these tests run under the `unit` (node) vitest project (`*.test.ts`). They spawn real `node` — allowed, fast.

- [ ] **Step 2: Run to see fail**

Run: `npx vitest run src/main/discussion/captureOnce.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `src/main/discussion/captureOnce.ts`**

```ts
import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import stripAnsi from 'strip-ansi'

export interface CaptureOpts {
  command: string; args?: string[]; cwd: string
  env?: Record<string, string>
  stdin?: string
  timeoutMs?: number
  signal?: AbortSignal
  maxBytes?: number
  stripEscapes?: boolean
}
export interface CaptureResult { stdout: string; stderr: string; code: number | null; signal: NodeJS.Signals | null; durationMs: number }
export class CaptureError extends Error {
  constructor(public reason: 'aborted' | 'timeout' | 'spawn' | 'overflow', msg: string) { super(msg); this.name = 'CaptureError' }
}

export function captureOnce(o: CaptureOpts): Promise<CaptureResult> {
  const t0 = Date.now()
  const timeoutMs = o.timeoutMs ?? 120_000
  const maxBytes = o.maxBytes ?? 25 * 1024 * 1024
  const win = process.platform === 'win32'
  const timeoutSig = AbortSignal.timeout(timeoutMs)
  const combined = o.signal ? AbortSignal.any([o.signal, timeoutSig]) : timeoutSig

  return new Promise<CaptureResult>((resolve, reject) => {
    const child = spawn(o.command, o.args ?? [], {
      cwd: o.cwd, env: { ...process.env, ...(o.env ?? {}) },
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], detached: !win, shell: false,
    })
    let exited = false, settled = false, total = 0
    const outDec = new StringDecoder('utf8'), errDec = new StringDecoder('utf8')
    const out: string[] = [], err: string[] = []

    const treeKill = () => {
      if (exited || child.pid == null) return
      if (win) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
      else { try { process.kill(-child.pid, 'SIGTERM') } catch { /* ignore */ } setTimeout(() => { try { process.kill(-child.pid!, 'SIGKILL') } catch { /* ignore */ } }, 2000) }
    }
    const cleanup = () => combined.removeEventListener('abort', onAbort)
    const fail = (reason: CaptureError['reason'], msg: string) => { if (settled) return; settled = true; cleanup(); treeKill(); reject(new CaptureError(reason, msg)) }
    function onAbort() { const aborted = o.signal?.aborted ?? false; fail(aborted ? 'aborted' : 'timeout', aborted ? 'capture aborted' : `timed out after ${timeoutMs}ms`) }
    combined.addEventListener('abort', onAbort, { once: true })

    child.on('error', (e) => fail('spawn', e.message))
    child.stdout.on('data', (c: Buffer) => { total += c.length; if (total > maxBytes) return fail('overflow', `stdout > ${maxBytes} bytes`); out.push(outDec.write(c)) })
    child.stderr.on('data', (c: Buffer) => { err.push(errDec.write(c)) })
    child.on('exit', () => { exited = true })
    child.on('close', (code, sig) => {
      if (settled) return; settled = true; cleanup()
      out.push(outDec.end()); err.push(errDec.end())
      let stdout = out.join(''), stderr = err.join('')
      if (o.stripEscapes ?? true) { stdout = stripAnsi(stdout); stderr = stripAnsi(stderr) }
      resolve({ stdout, stderr, code, signal: sig, durationMs: Date.now() - t0 })
    })

    if (o.stdin != null) child.stdin.end(o.stdin); else child.stdin.end()
  })
}
```

- [ ] **Step 4: Run to see pass**

Run: `npx vitest run src/main/discussion/captureOnce.test.ts` → PASS (5 tests). Then `npm run typecheck` → 0. (`strip-ansi` v7 is ESM default export; vitest/electron-vite handle it. If a CJS interop issue arises in tests, it won't — vitest runs ESM.)

- [ ] **Step 5: Commit**

```bash
git add src/main/discussion/captureOnce.ts src/main/discussion/captureOnce.test.ts
git commit -m "feat: captureOnce (spawn pipes, StringDecoder, abort/timeout/tree-kill)"
```

---

## Task 5: CliAdapter (AgentAdapter via captureOnce)

**Files:** `src/main/discussion/cliAdapter.ts`; Test `src/main/discussion/cliAdapter.test.ts`

- [ ] **Step 1: Write failing test `src/main/discussion/cliAdapter.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('./captureOnce', () => ({ captureOnce: vi.fn(), CaptureError: class extends Error { constructor(public reason: string, m: string) { super(m) } } }))
import { captureOnce } from './captureOnce'
import { CliAdapter } from './cliAdapter'
import type { ProfileEntry } from '@shared/types'

const profiles: Record<string, ProfileEntry> = {
  claude: { command: 'claude', discuss: { argsTemplate: ['-p', '{{prompt}}'] } },
  withStdin: { command: 'foo', discuss: { argsTemplate: [], stdin: true } },
}

async function drain(it: AsyncIterable<{ type: string; text?: string; message?: string }>) {
  const out: { type: string; text?: string; message?: string }[] = []
  for await (const c of it) out.push(c); return out
}

describe('CliAdapter', () => {
  it('substitui {{prompt}} nos args e emite final com stdout', async () => {
    ;(captureOnce as any).mockResolvedValue({ stdout: 'resposta', stderr: '', code: 0 })
    const a = new CliAdapter((id) => profiles[id])
    const chunks = await drain(a.run({ participantId: 'p', profileId: 'claude', prompt: 'oi', cwd: '/x', signal: new AbortController().signal }))
    expect((captureOnce as any).mock.calls[0][0].args).toEqual(['-p', 'oi'])
    expect(chunks).toEqual([{ type: 'final', text: 'resposta' }])
  })
  it('stdin mode manda prompt por stdin', async () => {
    ;(captureOnce as any).mockResolvedValue({ stdout: 'r', stderr: '', code: 0 })
    const a = new CliAdapter((id) => profiles[id])
    await drain(a.run({ participantId: 'p', profileId: 'withStdin', prompt: 'PP', cwd: '/x', signal: new AbortController().signal }))
    expect((captureOnce as any).mock.calls[0][0].stdin).toBe('PP')
  })
  it('CaptureError -> chunk error', async () => {
    ;(captureOnce as any).mockRejectedValue(new (await import('./captureOnce')).CaptureError('timeout', 'boom'))
    const a = new CliAdapter((id) => profiles[id])
    const chunks = await drain(a.run({ participantId: 'p', profileId: 'claude', prompt: 'oi', cwd: '/x', signal: new AbortController().signal }))
    expect(chunks[0].type).toBe('error')
  })
})
```

- [ ] **Step 2: Run to see fail**

Run: `npx vitest run src/main/discussion/cliAdapter.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `src/main/discussion/cliAdapter.ts`**

```ts
import { captureOnce, CaptureError } from './captureOnce'
import type { AgentAdapter, AgentChunk, AgentTurnRequest } from '@shared/discussion/types'
import type { ProfileEntry } from '@shared/types'

const FALLBACK = ['-p', '{{prompt}}']

export class CliAdapter implements AgentAdapter {
  constructor(private getProfile: (id: string) => ProfileEntry | undefined) {}

  async *run(req: AgentTurnRequest): AsyncIterable<AgentChunk> {
    const profile = this.getProfile(req.profileId)
    if (!profile) { yield { type: 'error', message: `perfil ${req.profileId} não encontrado` }; return }
    const d = profile.discuss
    const template = d?.argsTemplate ?? FALLBACK
    const useStdin = d?.stdin === true
    const args = [...(profile.args ?? []), ...template.map((a) => (a === '{{prompt}}' ? req.prompt : a)).filter((a) => !(useStdin && a === req.prompt && false))]
    // when stdin mode, do NOT put the prompt in args (template should omit {{prompt}})
    const finalArgs = useStdin ? [...(profile.args ?? []), ...template.filter((a) => a !== '{{prompt}}')] : args
    try {
      const r = await captureOnce({
        command: profile.command, args: finalArgs, cwd: req.cwd,
        env: profile.env, stdin: useStdin ? req.prompt : undefined,
        timeoutMs: d?.timeoutMs, signal: req.signal,
      })
      yield { type: 'final', text: r.stdout.trim() }
    } catch (e) {
      const msg = e instanceof CaptureError ? `${e.reason}: ${e.message}` : e instanceof Error ? e.message : String(e)
      yield { type: 'error', message: msg }
    }
  }
}
```
NOTE: simplify the args logic to exactly: pipe mode → `[...profile.args, ...template.map(a => a==='{{prompt}}'?req.prompt:a)]`; stdin mode → `[...profile.args, ...template.filter(a => a!=='{{prompt}}')]` with `stdin: req.prompt`. Remove the convoluted `.filter(... && false)` line; use the clean `finalArgs` only.

- [ ] **Step 4: Run to see pass**

Run: `npx vitest run src/main/discussion/cliAdapter.test.ts` → PASS (3 tests). `npm run typecheck` → 0.

- [ ] **Step 5: Commit**

```bash
git add src/main/discussion/cliAdapter.ts src/main/discussion/cliAdapter.test.ts
git commit -m "feat: CliAdapter (profile -> headless one-shot via captureOnce)"
```

---

## Task 6: DiscussionStore + DiscussionRunner

**Files:** `src/main/discussion/discussionStore.ts`; `src/main/discussion/discussionRunner.ts`; Test `src/main/discussion/discussionRunner.test.ts`

- [ ] **Step 1: Create `src/main/discussion/discussionStore.ts`**

```ts
import ElectronStore from 'electron-store'
import type { Discussion } from '@shared/discussion/types'

const Store = (ElectronStore as unknown as { default?: typeof ElectronStore }).default ?? ElectronStore

export class DiscussionStore {
  private store = new Store<{ discussions: Discussion[] }>({ name: 'maestro-discussions' })
  list(): Discussion[] { return this.store.get('discussions') ?? [] }
  get(id: string): Discussion | null { return this.list().find((d) => d.id === id) ?? null }
  upsert(d: Discussion): void {
    const all = this.list().filter((x) => x.id !== d.id)
    this.store.set('discussions', [d, ...all].slice(0, 50))
  }
  delete(id: string): void { this.store.set('discussions', this.list().filter((d) => d.id !== id)) }
}
```

- [ ] **Step 2: Write failing test `src/main/discussion/discussionRunner.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest'
import { DiscussionRunner } from './discussionRunner'
import { MockAdapter } from '@shared/discussion/mockAdapter'
import type { Discussion } from '@shared/discussion/types'

function fakeStore() {
  const m = new Map<string, Discussion>()
  return { list: () => [...m.values()], get: (id: string) => m.get(id) ?? null, upsert: (d: Discussion) => m.set(d.id, d), delete: (id: string) => m.delete(id), _m: m } as any
}

describe('DiscussionRunner', () => {
  it('start roda engine e persiste com cards; emite eventos', async () => {
    const store = fakeStore()
    const events: { id: string; type: string }[] = []
    const runner = new DiscussionRunner({
      store,
      makeAdapter: () => new MockAdapter((req) => req.role === 'orchestrator' ? '{"kind":"decision","title":"t","body":"b"}' : 'pos'),
      resolveProfiles: () => ({ a: { command: 'a' }, b: { command: 'b' } }),
      projectRoot: () => null,
      isTrusted: () => true,
      emit: (id, ev) => events.push({ id, type: ev.type }),
      now: () => 1, ids: (() => { let i = 0; return () => `id${i++}` })(),
    })
    const { id } = await runner.start({ topic: 't', templateKind: 'decision', orchestratorProfileId: 'a', participantProfileIds: ['a', 'b'], autonomous: true })
    await runner.waitFor(id)
    const d = store.get(id)!
    expect(d.status).toBe('done')
    expect(d.cards.length).toBeGreaterThanOrEqual(1)
    expect(events.some((e) => e.type === 'card')).toBe(true)
  })

  it('bloqueia quando participante de projeto e não confiável', async () => {
    const store = fakeStore()
    const runner = new DiscussionRunner({
      store, makeAdapter: () => new MockAdapter(() => 'x'),
      resolveProfiles: () => ({ a: { command: 'a' }, b: { command: 'b' } }),
      projectRoot: () => '/proj', isTrusted: () => false,
      emit: () => {}, now: () => 1, ids: () => 'x',
    })
    await expect(runner.start({ topic: 't', templateKind: 'decision', orchestratorProfileId: 'a', participantProfileIds: ['a', 'b'], autonomous: true }))
      .rejects.toThrow(/TRUST_REQUIRED/)
  })
})
```

- [ ] **Step 3: Run to see fail**

Run: `npx vitest run src/main/discussion/discussionRunner.test.ts` → FAIL.

- [ ] **Step 4: Implement `src/main/discussion/discussionRunner.ts`**

```ts
import { runDiscussion } from '@shared/discussion/engine'
import { assignRoles, buildFlow } from '@shared/discussion/templates'
import type { AgentAdapter, Discussion, DiscussionEvent, DiscussionInput } from '@shared/discussion/types'
import type { ProfileEntry } from '@shared/types'
import { TRUST_REQUIRED } from '@shared/ipc'

export interface RunnerDeps {
  store: { list(): Discussion[]; get(id: string): Discussion | null; upsert(d: Discussion): void; delete(id: string): void }
  makeAdapter: () => AgentAdapter
  resolveProfiles: () => Record<string, ProfileEntry>
  projectRoot: () => string | null
  isTrusted: (root: string) => boolean
  emit: (id: string, ev: DiscussionEvent) => void
  now: () => number
  ids: () => string
}

export interface StartArgs { topic: string; templateKind: Discussion['templateKind']; orchestratorProfileId: string; participantProfileIds: string[]; autonomous: boolean }

export class DiscussionRunner {
  private aborts = new Map<string, AbortController>()
  private done = new Map<string, Promise<void>>()
  private approvals = new Map<string, (v: { approve: boolean }) => void>()
  constructor(private deps: RunnerDeps) {}

  async start(a: StartArgs): Promise<{ id: string }> {
    const profiles = this.deps.resolveProfiles()
    const root = this.deps.projectRoot()
    const usedIds = [a.orchestratorProfileId, ...a.participantProfileIds]
    const anyProject = usedIds.some((pid) => /* project-origin if not preset/global key; here treat presence of root as gate trigger */ root != null)
    if (root && anyProject && !this.deps.isTrusted(root)) throw new Error(TRUST_REQUIRED)

    const id = this.deps.ids()
    const participants = assignRoles(a.templateKind, a.participantProfileIds)
    const orchestrator = { id: this.deps.ids(), role: 'orchestrator', profileId: a.orchestratorProfileId }
    const flow = buildFlow(a.templateKind, participants)
    const input: DiscussionInput = { topic: a.topic, flow, participants, orchestrator, autonomous: a.autonomous }

    const disc: Discussion = {
      id, topic: a.topic, templateKind: a.templateKind, orchestratorProfileId: a.orchestratorProfileId,
      participants, autonomous: a.autonomous, status: 'running', transcript: [], cards: [],
      createdAt: this.deps.now(), updatedAt: this.deps.now(), projectRoot: root,
    }
    this.deps.store.upsert(disc)

    const ac = new AbortController(); this.aborts.set(id, ac)
    this.done.set(id, this.runLoop(id, disc, input, ac))
    return { id }
  }

  private async runLoop(id: string, disc: Discussion, input: DiscussionInput, ac: AbortController): Promise<void> {
    const gen = runDiscussion(input, { adapter: this.deps.makeAdapter(), now: this.deps.now, ids: this.deps.ids, signal: ac.signal })
    const persist = () => { disc.updatedAt = this.deps.now(); this.deps.store.upsert(disc) }
    try {
      let res = await gen.next()
      while (!res.done) {
        const ev = res.value
        this.deps.emit(id, ev)
        if (ev.type === 'turn-end' || ev.type === 'synthesis') { disc.transcript.push(ev.turn); persist() }
        else if (ev.type === 'card') { disc.cards.push(ev.card); persist() }
        if (ev.type === 'awaiting-approval') {
          disc.status = 'awaiting-approval'; persist(); this.deps.emit(id, { type: 'status', status: 'awaiting-approval' })
          const approval = await new Promise<{ approve: boolean }>((r) => this.approvals.set(id, r))
          this.approvals.delete(id)
          res = await gen.next(approval as never)
        } else { res = await gen.next() }
      }
      disc.status = res.value.status; persist()
      this.deps.emit(id, { type: 'status', status: disc.status })
    } catch (e) {
      disc.status = 'error'; persist()
      this.deps.emit(id, { type: 'error', message: e instanceof Error ? e.message : String(e) })
      this.deps.emit(id, { type: 'status', status: 'error' })
    } finally { this.aborts.delete(id) }
  }

  abort(id: string): void { this.aborts.get(id)?.abort() }
  approve(id: string, approve: boolean): void { this.approvals.get(id)?.({ approve }) }
  abortAll(): void { for (const ac of this.aborts.values()) ac.abort() }
  waitFor(id: string): Promise<void> { return this.done.get(id) ?? Promise.resolve() }
}
```
NOTE: the `anyProject` gate is intentionally conservative — if a project is open (`root != null`), discussion spawns run in the project cwd, so require trust. (Refine to per-profile origin later; for v1, gate whenever a project root is set, matching #2's project-cwd spawn rule.)

- [ ] **Step 5: Run to see pass + typecheck**

Run: `npx vitest run src/main/discussion/discussionRunner.test.ts && npm run typecheck` → PASS (2); typecheck 0.

- [ ] **Step 6: Commit**

```bash
git add src/main/discussion/discussionStore.ts src/main/discussion/discussionRunner.ts src/main/discussion/discussionRunner.test.ts
git commit -m "feat: DiscussionStore + DiscussionRunner (engine wiring, persist, trust gate, abort/approve)"
```

---

## Task 7: IPC handlers + main wiring + preload event

**Files:** Modify `src/main/ipcRouter.ts`, `src/main/index.ts`, `src/preload/index.ts`

- [ ] **Step 1: Extend `src/main/ipcRouter.ts`** — add `discussion: DiscussionRunner` + `discussionStore` to `RouterDeps`, and handlers

Add imports:
```ts
import { DiscussionRunner } from './discussion/discussionRunner'
import { DiscussionStore } from './discussion/discussionStore'
```
Add to `RouterDeps`:
```ts
  discussion: DiscussionRunner
  discussionStore: DiscussionStore
```
Add handlers inside `registerIpc` (after the trust handlers):
```ts
  handle('discussion:start', (a) => deps.discussion.start(a))
  handle('discussion:list', () => deps.discussionStore.list())
  handle('discussion:get', (a) => deps.discussionStore.get(a.id))
  handle('discussion:abort', (a) => { deps.discussion.abort(a.id) })
  handle('discussion:delete', (a) => { deps.discussion.abort(a.id); deps.discussionStore.delete(a.id) })
  handle('discussion:approve', (a) => { deps.discussion.approve(a.id, a.approve) })
```
NOTE: `discussion:list` has no schema in `schemaByChannel` (like `config:get`) — the `handle` wrapper passes `raw` through when no schema; fine.

- [ ] **Step 2: Modify `src/main/index.ts`** — construct store + runner, wire emit to per-id channel, abort on quit

Add imports:
```ts
import { DiscussionStore } from './discussion/discussionStore'
import { DiscussionRunner } from './discussion/discussionRunner'
import { CliAdapter } from './discussion/cliAdapter'
import { isTrusted } from './trust'
import { discussionEventChannel } from '@shared/ipc'
import { randomUUID } from 'node:crypto'
```
FIRST extend `src/main/projectManager.ts` to cache the project's raw entries and expose a sync effective-entry map (so discussion participants can include project-defined profiles). Add a private field and update it inside `state()` where `projectEntries` is computed, plus a public getter:
```ts
// in ProjectManager:
import { PROFILE_PRESETS } from '@shared/presets'
private projectEntries: Record<string, ProfileEntry> = {}
// inside state(), right after computing projectEntries from loadMaestroConfig:
//   this.projectEntries = projectEntries
// new public method:
effectiveEntries(): Record<string, ProfileEntry> {
  return { ...PROFILE_PRESETS, ...this.config.get().globalProfiles, ...this.projectEntries }
}
```
(Note: `state()` runs on `open()` and on every watcher change, so `projectEntries` is fresh whenever a project is open. With no project open, the map is `{}` and `effectiveEntries()` returns presets+global.)

Then, after `project` is constructed in index.ts, add:
```ts
const discussionStore = new DiscussionStore()
const discussion = new DiscussionRunner({
  store: discussionStore,
  makeAdapter: () => new CliAdapter((pid) => project.effectiveEntries()[pid]),
  resolveProfiles: () => project.effectiveEntries(),
  projectRoot: () => config.get().currentProject,
  isTrusted: (root) => isTrusted(root, config.get().trust),
  emit: (id, ev) => { if (win && !win.webContents.isDestroyed()) win.webContents.send(discussionEventChannel(id), ev) },
  now: () => Date.now(),
  ids: () => randomUUID(),
})
```
This makes discussion participants resolve from presets + global + the currently-open project's `maestro.yml` profiles, so the e2e's project-defined `pro`/`con`/`orch` profiles work.

Pass into `registerIpc`:
```ts
  registerIpc({ config, ptyHost, project, discussion, discussionStore, isTrustedSender: makeSenderGuard(DEV_URL, app.isPackaged), scrollback: {...} })
```
Add to `before-quit`:
```ts
app.on('before-quit', () => { ptyHost.dispose(); project.stop(); discussion.abortAll() })
```

- [ ] **Step 3: Modify `src/preload/index.ts`** — add `onDiscussionEvent`

Add to the `api` object:
```ts
  onDiscussionEvent(id: string, cb: (ev: import('@shared/discussion/types').DiscussionEvent) => void): () => void {
    const ch = `discussion:event:${id}`
    const h = (_e: Electron.IpcRendererEvent, ev: import('@shared/discussion/types').DiscussionEvent) => cb(ev)
    ipcRenderer.on(ch, h)
    return () => ipcRenderer.removeListener(ch, h)
  },
```

- [ ] **Step 4: Typecheck + build + tests**

Run: `npm run typecheck && npm run test:unit && npm run build`
Expected: typecheck 0; unit green; build clean. Fix the `effectiveProfileEntries` `require` if ESM build complains — replace `require('@shared/presets')` with a top `import { PROFILE_PRESETS } from '@shared/presets'`.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipcRouter.ts src/main/index.ts src/preload/index.ts
git commit -m "feat: discussion IPC handlers + runner wiring + per-id event push + preload"
```

---

## Task 8: Renderer discussionStore + NewDiscussionModal + DiscussionsButton

**Files:** `src/renderer/store/discussionStore.ts`; `src/renderer/ui/NewDiscussionModal.tsx`; `src/renderer/ui/DiscussionsButton.tsx`

- [ ] **Step 1: Create `src/renderer/store/discussionStore.ts`**

```ts
import { create } from 'zustand'
import type { Discussion, DiscussionEvent } from '@shared/discussion/types'

interface DiscussionStore {
  list: Discussion[]
  active: Discussion | null
  refresh: () => Promise<void>
  open: (id: string) => Promise<void>
  applyEvent: (ev: DiscussionEvent) => void
  closeActive: () => void
}

export const useDiscussions = create<DiscussionStore>((set, get) => ({
  list: [], active: null,
  refresh: async () => set({ list: await window.term.invoke('discussion:list', undefined) }),
  open: async (id) => { const d = await window.term.invoke('discussion:get', { id }); if (d) set({ active: d }) },
  closeActive: () => set({ active: null }),
  applyEvent: (ev) => {
    const a = get().active
    if (!a) return
    const next: Discussion = { ...a, transcript: [...a.transcript], cards: [...a.cards] }
    if (ev.type === 'turn-end' || ev.type === 'synthesis') next.transcript.push(ev.turn)
    else if (ev.type === 'card') next.cards.push(ev.card)
    else if (ev.type === 'status') next.status = ev.status
    set({ active: next })
  },
}))
```

- [ ] **Step 2: Create `src/renderer/ui/NewDiscussionModal.tsx`**

```tsx
import { useState } from 'react'
import { useProject } from '../store/projectStore'
import type { TemplateKind } from '@shared/discussion/types'

const TEMPLATES: { kind: TemplateKind; name: string; desc: string }[] = [
  { kind: 'decision', name: 'Decision', desc: 'Dois lados argumentam; termina em decisão.' },
  { kind: 'brainstorm', name: 'Brainstorm', desc: 'Perspectivas variadas; termina em síntese.' },
  { kind: 'review', name: 'Review', desc: 'Defensor vs atacante sobre código/abordagem.' },
  { kind: 'plan', name: 'Plan', desc: 'Lentes de produto e engenharia montam um plano.' },
  { kind: 'dev-squad', name: 'Dev squad', desc: 'Divide a feature entre os agentes em paralelo.' },
  { kind: 'custom', name: 'Custom', desc: 'Todos respondem; orquestrador sintetiza.' },
]

export function NewDiscussionModal({ onClose, onStarted }: { onClose: () => void; onStarted: (id: string) => void }) {
  const profiles = useProject((s) => s.profiles)
  const [kind, setKind] = useState<TemplateKind>('decision')
  const [topic, setTopic] = useState('')
  const [orchestrator, setOrchestrator] = useState(profiles[0]?.id ?? '')
  const [parts, setParts] = useState<string[]>([])
  const [autonomous, setAutonomous] = useState(true)
  const [err, setErr] = useState('')

  function toggle(id: string) { setParts((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])) }
  async function start() {
    if (parts.length < 2) { setErr('Escolha ao menos 2 participantes'); return }
    if (!orchestrator) { setErr('Escolha um orquestrador'); return }
    try {
      const { id } = await window.term.invoke('discussion:start', { topic: topic || '(sem tópico)', templateKind: kind, orchestratorProfileId: orchestrator, participantProfileIds: parts, autonomous })
      onStarted(id)
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      setErr(m.includes('TRUST_REQUIRED') ? 'Confie no projeto antes de iniciar.' : m)
    }
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-[640px] max-h-[90vh] overflow-auto rounded-lg border border-zinc-700 bg-zinc-900 p-5 text-sm" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 text-base font-semibold">Nova discussão</div>
        <div className="mb-1 text-xs text-zinc-400">Template</div>
        <div className="mb-4 grid grid-cols-2 gap-2">
          {TEMPLATES.map((t) => (
            <button key={t.kind} onClick={() => setKind(t.kind)}
              className={`rounded border p-2 text-left ${kind === t.kind ? 'border-amber-500 bg-amber-950/30' : 'border-zinc-700 bg-zinc-800/40'}`}>
              <div className="font-medium">{t.name}</div>
              <div className="text-[11px] text-zinc-400">{t.desc}</div>
            </button>
          ))}
        </div>
        <div className="mb-1 text-xs text-zinc-400">Tópico</div>
        <textarea value={topic} onChange={(e) => setTopic(e.target.value)} rows={2} className="mb-4 w-full rounded bg-zinc-800 p-2" placeholder="ex: Stripe ou Paddle para billing?" />
        <div className="mb-1 text-xs text-zinc-400">Orquestrador</div>
        <select value={orchestrator} onChange={(e) => setOrchestrator(e.target.value)} className="mb-4 w-full rounded bg-zinc-800 p-2">
          {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div className="mb-1 text-xs text-zinc-400">Participantes (≥2)</div>
        <div className="mb-4 flex flex-wrap gap-2">
          {profiles.map((p) => (
            <button key={p.id} onClick={() => toggle(p.id)}
              className={`flex items-center gap-1 rounded border px-2 py-1 ${parts.includes(p.id) ? 'border-sky-500 bg-sky-950/40' : 'border-zinc-700'}`}>
              <span className="h-2 w-2 rounded-full" style={{ background: p.color ?? '#6e7681' }} />{p.name}
            </button>
          ))}
        </div>
        <label className="mb-4 flex items-center gap-2 text-xs"><input type="checkbox" checked={autonomous} onChange={(e) => setAutonomous(e.target.checked)} /> Modo autônomo</label>
        {err && <div className="mb-2 text-xs text-red-400">{err}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded px-3 py-1 text-zinc-400">Cancelar</button>
          <button onClick={start} className="rounded bg-amber-600 px-3 py-1 text-white">Start discussion</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create `src/renderer/ui/DiscussionsButton.tsx`**

```tsx
export function DiscussionsButton({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick} className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-200">Discussões</button>
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck` → 0 (App not yet wired to these; they're standalone until Task 9 — typecheck of the new files passes since they only import existing stores/types).

- [ ] **Step 5: (commit combined in Task 9)**

---

## Task 9: DiscussionView + DiscussionList + App wiring

**Files:** `src/renderer/ui/DiscussionView.tsx`; `src/renderer/ui/DiscussionList.tsx`; Modify `src/renderer/App.tsx`; Test `src/renderer/ui/NewDiscussionModal.browser.test.tsx`

- [ ] **Step 1: Create `src/renderer/ui/DiscussionView.tsx`**

```tsx
import { useEffect } from 'react'
import { useDiscussions } from '../store/discussionStore'

export function DiscussionView({ id }: { id: string }) {
  const active = useDiscussions((s) => s.active)
  const open = useDiscussions((s) => s.open)
  const applyEvent = useDiscussions((s) => s.applyEvent)

  useEffect(() => {
    void open(id)
    const off = window.term.onDiscussionEvent(id, (ev) => applyEvent(ev))
    return off
  }, [id, open, applyEvent])

  if (!active || active.id !== id) return <div className="p-4 text-sm text-zinc-500">carregando…</div>
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <span className="text-sm font-medium">{active.topic}</span>
        <span className="rounded bg-zinc-800 px-1.5 text-[10px] text-zinc-400">{active.templateKind}</span>
        <span className="text-[10px] text-zinc-500">{active.status}</span>
        {active.status === 'running' && <button onClick={() => window.term.invoke('discussion:abort', { id })} className="ml-auto rounded bg-red-900/50 px-2 text-xs text-red-200">abortar</button>}
        {active.status === 'awaiting-approval' && <button onClick={() => window.term.invoke('discussion:approve', { id, approve: true })} className="ml-auto rounded bg-amber-600 px-2 text-xs text-white">aprovar</button>}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        {active.transcript.map((t) => (
          <div key={t.id} className={`rounded border p-2 ${t.isSynthesis ? 'border-amber-700/40 bg-amber-950/20' : 'border-zinc-800'}`}>
            <div className="mb-1 text-[11px] text-zinc-400">{t.role}{t.error ? ' · erro' : ''}</div>
            <div className="whitespace-pre-wrap text-sm">{t.error ? `⚠ ${t.error}` : t.text}</div>
          </div>
        ))}
        {active.cards.map((c, i) => (
          <div key={`c${i}`} className="rounded border border-sky-700/50 bg-sky-950/20 p-3">
            <div className="mb-1 text-[10px] uppercase text-sky-300">{c.kind}</div>
            <div className="font-semibold">{c.title}</div>
            <div className="whitespace-pre-wrap text-sm">{c.body}</div>
            {c.dissents && c.dissents.length > 0 && <div className="mt-2 text-xs text-amber-300">Dissensos: {c.dissents.join('; ')}</div>}
            {c.actions && c.actions.length > 0 && <ul className="mt-2 list-disc pl-4 text-xs">{c.actions.map((a, j) => <li key={j}>{a.owner ? `${a.owner}: ` : ''}{a.task}</li>)}</ul>}
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create `src/renderer/ui/DiscussionList.tsx`**

```tsx
import { useEffect } from 'react'
import { useDiscussions } from '../store/discussionStore'

export function DiscussionList({ onOpen }: { onOpen: (id: string) => void }) {
  const list = useDiscussions((s) => s.list)
  const refresh = useDiscussions((s) => s.refresh)
  useEffect(() => { void refresh() }, [refresh])
  return (
    <div className="w-72 shrink-0 border-l border-zinc-800 p-2 text-sm">
      <div className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Discussões</div>
      {list.length === 0 && <div className="text-xs text-zinc-600">nenhuma</div>}
      {list.map((d) => (
        <div key={d.id} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-zinc-800" onClick={() => onOpen(d.id)}>
          <span className="flex-1 truncate">{d.topic}</span>
          <span className="text-[10px] text-zinc-500">{d.status}</span>
          <button onClick={(e) => { e.stopPropagation(); void window.term.invoke('discussion:delete', { id: d.id }).then(() => refresh()) }} className="text-zinc-600 hover:text-red-400">×</button>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Write failing component test `src/renderer/ui/NewDiscussionModal.browser.test.tsx`**

```tsx
import { render } from 'vitest-browser-react'
import { expect, test, vi, beforeEach } from 'vitest'
import { NewDiscussionModal } from './NewDiscussionModal'
import { useProject } from '../store/projectStore'

beforeEach(() => useProject.setState({ currentProject: null, trusted: true, recentProjects: [], problems: [], hasMaestroFile: false,
  profiles: [
    { id: 'claude', name: 'claude', command: 'claude', args: [], autoStart: false, source: 'preset' },
    { id: 'codex', name: 'codex', command: 'codex', args: [], autoStart: false, source: 'preset' },
  ] }))

test('exige >=2 participantes antes de iniciar', async () => {
  ;(window as any).term = { invoke: vi.fn().mockResolvedValue({ id: 'd1' }) }
  const screen = render(<NewDiscussionModal onClose={() => {}} onStarted={() => {}} />)
  await screen.getByText('Start discussion').click()
  await expect.element(screen.getByText(/ao menos 2/)).toBeVisible()
})
```

- [ ] **Step 4: Run to see fail**

Run: `npm run test:component` → the new test FAILS (NewDiscussionModal not rendering / assertion). Actually it should fail first because App import chain — run only this file: `npx vitest run --project pane src/renderer/ui/NewDiscussionModal.browser.test.tsx`. Expected initial FAIL if anything off; then PASS once components compile.

- [ ] **Step 5: Modify `src/renderer/App.tsx`** — wire discussions (modal + list + view)

Replace App with the #2 version plus discussions. Add state `discussion: { showModal, openId } ` and render. Full replacement:
```tsx
import { useEffect, useRef, useState } from 'react'
import { Sidebar } from './ui/Sidebar'
import { Toolbar } from './ui/Toolbar'
import { ProjectBar } from './ui/ProjectBar'
import { RestrictedBanner } from './ui/RestrictedBanner'
import { MaestroProblems } from './ui/MaestroProblems'
import { GlobalProfiles } from './ui/GlobalProfiles'
import { DiscussionsButton } from './ui/DiscussionsButton'
import { NewDiscussionModal } from './ui/NewDiscussionModal'
import { DiscussionList } from './ui/DiscussionList'
import { DiscussionView } from './ui/DiscussionView'
import { Grid } from './grid/Grid'
import { useGrid } from './store/gridStore'
import { useProject } from './store/projectStore'
import { useDiscussions } from './store/discussionStore'
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
  const [showModal, setShowModal] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [showDiscussions, setShowDiscussions] = useState(false)
  const refreshDiscussions = useDiscussions((s) => s.refresh)

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

  useEffect(() => { autoStarted.current = new Set() }, [project.currentProject])
  useEffect(() => { if (!hydrated.current) return; void window.term.invoke('config:set', { patch: { panes, activeLayout: useGrid.getState().activeLayout } }) }, [panes])

  function paneFromProfile(p: Profile): PaneConfig {
    const isProject = p.source === 'project'
    return { id: uuid(), name: p.name, command: p.command, args: p.args, cwd: p.cwd ?? project.currentProject ?? '.', env: p.env, color: p.color, profileId: p.id, origin: isProject ? 'project' : 'user', projectRoot: project.currentProject ?? undefined }
  }
  function pickProfile(p: Profile) { addPane(paneFromProfile(p)) }

  useEffect(() => {
    if (!project.trusted || !project.currentProject) return
    for (const p of project.profiles) {
      if (p.source === 'project' && p.autoStart && !autoStarted.current.has(p.id)) { autoStarted.current.add(p.id); addPane(paneFromProfile(p)) }
    }
  }, [project.trusted, project.currentProject, project.profiles])

  return (
    <div className="flex h-full w-full flex-col">
      <ProjectBar />
      <MaestroProblems />
      <RestrictedBanner />
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-1">
        <DiscussionsButton onClick={() => { setShowDiscussions((v) => !v); void refreshDiscussions() }} />
        <button onClick={() => setShowModal(true)} className="rounded bg-amber-700/70 px-2 py-0.5 text-xs text-white">+ discussão</button>
      </div>
      <Toolbar onPickProfile={pickProfile} />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1">{openId ? <DiscussionView id={openId} /> : <Grid />}</main>
        {showDiscussions && <DiscussionList onOpen={(id) => setOpenId(id)} />}
      </div>
      {openId && <button onClick={() => setOpenId(null)} className="absolute bottom-2 right-2 z-40 rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300">← terminais</button>}
      <button onClick={() => setShowGlobals(true)} className="absolute bottom-2 left-2 z-40 rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">perfis globais</button>
      {showGlobals && <GlobalProfiles onClose={() => setShowGlobals(false)} />}
      {showModal && <NewDiscussionModal onClose={() => setShowModal(false)} onStarted={(id) => { setShowModal(false); setShowDiscussions(true); setOpenId(id); void refreshDiscussions() }} />}
    </div>
  )
}
```

- [ ] **Step 6: Typecheck + tests + build**

Run: `npm run typecheck && npm run test:unit && npm run test:component && npm run build`
Expected: all green. Fix selectors in the modal test if markup differs.

- [ ] **Step 7: Commit (combined Tasks 8+9)**

```bash
git add src/renderer
git commit -m "feat: discussions UI (modal, view, list) + App wiring + store"
```

---

## Task 10: E2E (echo profiles) + final verification

**Files:** `e2e/fixtures/discuss/maestro.yml`; `e2e/discussion.spec.ts`

- [ ] **Step 1: Create `e2e/fixtures/discuss/maestro.yml`** — fake echo profiles (no real AI CLI)

```yaml
version: 1
profiles:
  pro:
    name: Pro
    command: node
    color: "#3fb950"
    discuss:
      argsTemplate: ["-e", "process.stdout.write('PRO: spaces are better')"]
  con:
    name: Con
    command: node
    color: "#ff7b72"
    discuss:
      argsTemplate: ["-e", "process.stdout.write('CON: tabs are better')"]
  orch:
    name: Orchestrator
    command: node
    color: "#d97757"
    discuss:
      argsTemplate: ["-e", "process.stdout.write(JSON.stringify({kind:'decision',title:'Decisão',body:'spaces vencem',dissents:['con discorda']}))"]
```
NOTE: these profiles ignore `{{prompt}}` and emit fixed output via `node -e`, making the discussion deterministic and CI-safe (no AI CLI, no network).

- [ ] **Step 2: Create `e2e/discussion.spec.ts`**

```ts
import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, mkdirSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('inicia discussão decision com perfis echo e vê turnos + card', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'maestro-e2e-'))
  const proj = mkdtempSync(join(tmpdir(), 'maestro-proj-'))
  copyFileSync(join(process.cwd(), 'e2e/fixtures/discuss/maestro.yml'), join(proj, 'maestro.yml'))

  const app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`] })
  await app.evaluate(async ({ dialog }, dir) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] }) }, proj)
  const win = await app.firstWindow()
  await win.waitForSelector('text=Layout', { timeout: 20000 })

  await win.getByRole('button', { name: 'Abrir projeto ▾' }).click()
  await win.getByRole('button', { name: 'Abrir pasta…' }).click()
  await win.getByText(/Modo Restrito/).waitFor({ timeout: 10000 })
  await win.getByRole('button', { name: 'Confiar', exact: true }).click()

  await win.getByRole('button', { name: '+ discussão' }).click()
  // template decision já é o default; preenche tópico
  await win.locator('textarea').fill('spaces vs tabs')
  // orquestrador = orch
  await win.locator('select').selectOption({ label: 'Orchestrator' })
  // participantes pro + con
  await win.getByRole('button', { name: /Pro/ }).click()
  await win.getByRole('button', { name: /Con/ }).click()
  await win.getByRole('button', { name: 'Start discussion' }).click()

  // turnos aparecem
  await expect(win.getByText(/PRO: spaces are better/)).toBeVisible({ timeout: 20000 })
  await expect(win.getByText(/CON: tabs are better/)).toBeVisible({ timeout: 20000 })
  // card de decisão
  await expect(win.getByText(/spaces vencem/)).toBeVisible({ timeout: 20000 })
  await expect(win.getByText(/Dissensos/)).toBeVisible({ timeout: 20000 })
  await app.close()
})
```
NOTE: discussion participants come from `profiles` (the picker/modal lists effective profiles; the project ones `pro`/`con`/`orch` appear after trust). If the modal lists them by `name`, the role-button selectors use Pro/Con. The orchestrator select uses the option label "Orchestrator". Adjust selectors to the real rendered modal if needed (the app is source of truth) without weakening the assertions (must see both turns + the decision card with dissent).

- [ ] **Step 3: Build + run E2E**

Run: `npm run build && npm run test:e2e`
Expected: all three specs pass (terminal, profiles, discussion). The discussion spec spawns `node -e` echo profiles — deterministic, no AI CLI.

- [ ] **Step 4: Final verification**

Run: `npm run typecheck && npm run test:unit && npm run test:component && npm run build && npm run test:e2e`
Expected: typecheck 0; unit all green; component green; build clean; e2e all pass. `git status --porcelain` empty.

- [ ] **Step 5: Commit**

```bash
git add e2e
git commit -m "test: e2e discussion (echo profiles) + final verification"
```

---

## Self-Review (preenchido)

**Cobertura da spec:**
- §3 modelo → T1 (types/schemas/presets). §4.1 engine → T3. §4.2 templates → T2. §4.3 captureOnce → T4. §4.4 cliAdapter → T5. §4.5 store+runner → T6. §4.6 IPC → T7. §4.7 renderer → T8/T9. ✔
- §5 fluxos → T6 (runner loop), T9 (view assina evento). §6 erros → T3 (turn.error, card fallback), T4 (timeout/abort), T6 (status error, trust gate), T7 (abortAll quit). §7 testes → T2/T3/T4/T5/T6 (unit), T9 (component), T10 (e2e). ✔
- Trust → T6 gate + T7 wiring (isTrusted). System prompt por papel → T2 (PromptTemplate `system`) + T3 (passado no req) + adapter (v1 não injeta system flag por-CLI; system vai embutido no prompt? — NOTE: v1 o `system` é passado ao adapter mas o CliAdapter NÃO o usa como flag de CLI; ele já está refletido no prompt composto pelos templates que incluem o papel no texto. Aceito p/ v1; flag --system por-CLI fica pro #8). ✔

**Placeholder scan:** sem TBD/TODO; código completo. (As linhas "NOTE/FIX before commit" instruem limpezas pontuais — ex.: remover char não-ASCII no template dev-squad; usar a versão simples do MockAdapter; simplificar args do CliAdapter — não são placeholders, são correções explícitas.)

**Consistência de tipos:** `FlowSpec/Phase/Turn/DiscussionEvent/AgentAdapter/Participant/Discussion/DiscussInvoke` (T1) usados igual em T2/T3/T6. `runDiscussion(input,deps)` assinatura idêntica T3↔T6. `AgentTurnRequest{participantId,profileId,system,prompt,cwd,signal}` idêntico engine↔adapter. `captureOnce(CaptureOpts)→CaptureResult|CaptureError` idêntico T4↔T5. Canais `discussion:*` + `discussionEventChannel` idênticos T1(ipc)↔T7(handlers)↔preload/store. `discussionInput` schema (≥2) ↔ modal valida ≥2 ↔ runner. `SummaryCard` zod ↔ engine parseCard ↔ view render. ✔

**Limitações v1 anotadas (não-bloqueantes):** participantes resolvem de presets+global+projeto via `ProjectManager.effectiveEntries()` (perfis de projeto funcionam quando o projeto está aberto); `system` não vira flag por-CLI (embutido no prompt composto); sem streaming token-a-token (1 chunk final/turno); 1 re-ask no card; gate de trust dispara sempre que há projeto aberto (conservador). Tudo no roadmap do #8/futuro.
