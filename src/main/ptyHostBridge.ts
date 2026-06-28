import { utilityProcess, type UtilityProcess, type WebContents } from 'electron'
import { join } from 'node:path'
import { ptyDataChannel, ptyExitChannel } from '@shared/ipc'

type OutMsg =
  | { type: 'data'; id: string; data: string }
  | { type: 'exit'; id: string; code: number; reason?: string }

export class PtyHostBridge {
  private proc: UtilityProcess | null = null
  constructor(private getWebContents: () => WebContents | null) {}

  start(): void {
    // ptyHostEntry.js é emitido como segundo input do main build (Task 1 config)
    const entry = join(__dirname, 'ptyHostEntry.js')
    this.proc = utilityProcess.fork(entry, [], { stdio: 'inherit' })
    this.proc.on('message', (m: OutMsg) => {
      const wc = this.getWebContents()
      if (!wc || wc.isDestroyed()) return
      if (m.type === 'data') wc.send(ptyDataChannel(m.id), { data: m.data })
      else wc.send(ptyExitChannel(m.id), { code: m.code, reason: m.reason })
    })
  }

  private post(msg: unknown): void { this.proc?.postMessage(msg) }
  spawn(o: unknown): void { this.post({ type: 'spawn', o }) }
  write(id: string, data: string): void { this.post({ type: 'write', id, data }) }
  resize(id: string, cols: number, rows: number): void { this.post({ type: 'resize', id, cols, rows }) }
  kill(id: string): void { this.post({ type: 'kill', id }) }
  killAll(): void { this.post({ type: 'killAll' }) }
  dispose(): void { this.killAll(); this.proc?.kill(); this.proc = null }
}
