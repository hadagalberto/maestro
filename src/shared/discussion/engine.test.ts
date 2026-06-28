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
