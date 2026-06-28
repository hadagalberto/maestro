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
    const args = useStdin
      ? [...(profile.args ?? []), ...template.filter((a) => a !== '{{prompt}}')]
      : [...(profile.args ?? []), ...template.map((a) => (a === '{{prompt}}' ? req.prompt : a))]
    try {
      const r = await captureOnce({
        command: profile.command, args, cwd: req.cwd,
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
