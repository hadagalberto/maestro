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

export function buildFlow(kind: TemplateKind, _participants: Participant[]): FlowSpec {
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
      { id: 'split', label: 'Divisão', speakers: { kind: 'orchestrator' }, template: (ctx) => ({ system: 'You are the orchestrator.', prompt: `Topic: ${ctx.topic}\n\nSplit the work into one task per builder. List tasks clearly.` }), mode: 'sequential' },
      { id: 'build', label: 'Construção', speakers: { kind: 'all' }, template: rebutTpl(), mode: 'parallel' },
      { id: 'integrate', label: 'Integração', speakers: { kind: 'orchestrator' }, template: synthCardTpl('status'), mode: 'sequential', synthesize: { template: synthCardTpl('status'), card: 'status' } },
    ] }
    default: return { id: 'custom', kind: 'custom', ...base, phases: [
      { id: 'respond', label: 'Respostas', speakers: { kind: 'all' }, template: divergeTpl('Respond to the topic.'), mode: 'parallel' },
      { id: 'synth', label: 'Síntese', speakers: { kind: 'orchestrator' }, template: synthCardTpl('note'), mode: 'sequential', synthesize: { template: synthCardTpl('note'), card: 'note' } },
    ] }
  }
}
