import type { AgentAdapter, AgentChunk, AgentTurnRequest } from './types'

// Scripted adapter for deterministic tests: a responder function maps each
// request (and its per-participant call index) to the final text it returns.
export class MockAdapter implements AgentAdapter {
  constructor(private responder: (req: AgentTurnRequest, callIndex: number) => string) {}
  private calls = new Map<string, number>()
  async *run(req: AgentTurnRequest): AsyncIterable<AgentChunk> {
    const n = (this.calls.get(req.participantId) ?? 0) + 1
    this.calls.set(req.participantId, n)
    yield { type: 'final', text: this.responder(req, n) }
  }
}
