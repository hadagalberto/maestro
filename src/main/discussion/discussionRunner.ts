import { runDiscussion } from '@shared/discussion/engine'
import { assignRoles, buildFlow } from '@shared/discussion/templates'
import type { AgentAdapter, Discussion, DiscussionEvent, DiscussionInput } from '@shared/discussion/types'
import { TRUST_REQUIRED } from '@shared/ipc'

export interface RunnerDeps {
  store: { list(): Discussion[]; get(id: string): Discussion | null; upsert(d: Discussion): void; delete(id: string): void }
  makeAdapter: () => AgentAdapter
  projectProfileIds: () => string[]
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
    const root = this.deps.projectRoot()
    const usedIds = [a.orchestratorProfileId, ...a.participantProfileIds]
    const projectIds = this.deps.projectProfileIds()
    const usesProjectProfile = usedIds.some((id) => projectIds.includes(id))
    if (root && usesProjectProfile && !this.deps.isTrusted(root)) throw new Error(TRUST_REQUIRED)

    const id = this.deps.ids()
    const participants = assignRoles(a.templateKind, a.participantProfileIds)
    const orchestrator = { id: this.deps.ids(), role: 'orchestrator', profileId: a.orchestratorProfileId }
    const flow = buildFlow(a.templateKind, participants)
    const input: DiscussionInput = { topic: a.topic, flow, participants, orchestrator, autonomous: a.autonomous, cwd: root ?? '.' }

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

  abort(id: string): void {
    this.aborts.get(id)?.abort()
    this.approvals.get(id)?.({ approve: false })   // unblock an awaiting-approval gate so the loop can finish
  }
  approve(id: string, approve: boolean): void { this.approvals.get(id)?.({ approve }) }
  abortAll(): void { for (const id of this.aborts.keys()) this.abort(id) }
  waitFor(id: string): Promise<void> { return this.done.get(id) ?? Promise.resolve() }
}
