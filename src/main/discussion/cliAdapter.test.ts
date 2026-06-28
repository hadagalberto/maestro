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
    ;(captureOnce as any).mockReset()
    ;(captureOnce as any).mockResolvedValue({ stdout: 'resposta', stderr: '', code: 0 })
    const a = new CliAdapter((id) => profiles[id])
    const chunks = await drain(a.run({ participantId: 'p', profileId: 'claude', role: 'x', prompt: 'oi', cwd: '/x', signal: new AbortController().signal }))
    expect((captureOnce as any).mock.calls[0][0].args).toEqual(['-p', 'oi'])
    expect(chunks).toEqual([{ type: 'final', text: 'resposta' }])
  })
  it('stdin mode manda prompt por stdin', async () => {
    ;(captureOnce as any).mockReset()
    ;(captureOnce as any).mockResolvedValue({ stdout: 'r', stderr: '', code: 0 })
    const a = new CliAdapter((id) => profiles[id])
    await drain(a.run({ participantId: 'p', profileId: 'withStdin', role: 'x', prompt: 'PP', cwd: '/x', signal: new AbortController().signal }))
    expect((captureOnce as any).mock.calls[0][0].stdin).toBe('PP')
  })
  it('CaptureError -> chunk error', async () => {
    ;(captureOnce as any).mockReset()
    ;(captureOnce as any).mockRejectedValue(new (await import('./captureOnce')).CaptureError('timeout', 'boom'))
    const a = new CliAdapter((id) => profiles[id])
    const chunks = await drain(a.run({ participantId: 'p', profileId: 'claude', role: 'x', prompt: 'oi', cwd: '/x', signal: new AbortController().signal }))
    expect(chunks[0].type).toBe('error')
  })
})
