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
