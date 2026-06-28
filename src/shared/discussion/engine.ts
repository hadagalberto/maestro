import { summaryCardSchema } from '../schemas'
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

function parseCard(text: string, _kind: SummaryCard['kind']): SummaryCard | null {
  const obj = extractJson(text)
  if (!obj) return null
  const r = summaryCardSchema.safeParse(obj)
  return r.success ? r.data : null
}

function noteCard(text: string, _kind: SummaryCard['kind'], title: string): SummaryCard {
  return { kind: 'note', title, body: text.trim() || '(sem conteúdo)' }
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
    // A pure synthesis phase (orchestrator-only + synthesize) contributes only
    // its synthesis turn/card; skip the redundant orchestrator speaker round.
    const synthesisOnly = phase.speakers.kind === 'orchestrator' && !!phase.synthesize

    for (let round = 1; !synthesisOnly && round <= maxRound; round++) {
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
        const req: AgentTurnRequest = { participantId: p.sp.id, profileId: p.sp.profileId, role: p.sp.role, system, prompt, cwd: input.cwd ?? '.', signal }
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
      const r1 = await capture(adapter, { participantId: input.orchestrator.id, profileId: input.orchestrator.profileId, role: 'orchestrator', system: first.system, prompt: first.prompt, cwd: input.cwd ?? '.', signal })
      synth.text = r1.text; synth.error = r1.error; synth.createdAt = now()
      transcript.push(synth); yield { type: 'synthesis', turn: synth }

      let card = parseCard(synth.text, phase.synthesize.card)
      if (!card) {
        const r2 = await capture(adapter, { participantId: input.orchestrator.id, profileId: input.orchestrator.profileId, role: 'orchestrator', prompt: `${first.prompt}\n\nReturn ONLY the JSON object, nothing else.`, system: first.system, cwd: input.cwd ?? '.', signal })
        card = parseCard(r2.text, phase.synthesize.card) ?? noteCard(synth.text, phase.synthesize.card, phase.label)
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
