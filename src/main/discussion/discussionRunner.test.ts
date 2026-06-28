import { describe, it, expect } from 'vitest'
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
      projectProfileIds: () => [],
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
      projectProfileIds: () => ['a', 'b'],
      projectRoot: () => '/proj', isTrusted: () => false,
      emit: () => {}, now: () => 1, ids: () => 'x',
    })
    await expect(runner.start({ topic: 't', templateKind: 'decision', orchestratorProfileId: 'a', participantProfileIds: ['a', 'b'], autonomous: true }))
      .rejects.toThrow(/TRUST_REQUIRED/)
  })
})
