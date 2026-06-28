import type { WebContents } from 'electron'
import type { QueenResponse, TerminalOp } from '@shared/queen'

interface Pending { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }

export class RendererBridge {
  private pending = new Map<string, Pending>()
  constructor(private getWebContents: () => WebContents | null, private ids: () => string = () => crypto.randomUUID()) {}

  request(op: TerminalOp, args: Record<string, unknown>, timeoutMs = 8000): Promise<unknown> {
    const wc = this.getWebContents()
    if (!wc || wc.isDestroyed()) return Promise.reject(new Error('no window'))
    const reqId = this.ids()
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(reqId); reject(new Error('renderer timeout')) }, timeoutMs)
      this.pending.set(reqId, { resolve, reject, timer })
      wc.send('queen:req', { reqId, op, args })
    })
  }

  handleResponse(res: QueenResponse): void {
    const p = this.pending.get(res.reqId)
    if (!p) return
    clearTimeout(p.timer)
    this.pending.delete(res.reqId)
    if (res.ok) p.resolve(res.result)
    else p.reject(new Error(res.error ?? 'renderer error'))
  }
}
