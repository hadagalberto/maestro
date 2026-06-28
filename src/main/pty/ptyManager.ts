import * as pty from 'node-pty'
import { resolveLauncher } from './resolveLauncher'

export interface SpawnOpts {
  id: string; command: string; args?: string[]; cwd: string
  env?: Record<string, string>; cols: number; rows: number
}
export interface PtySinks {
  onData: (id: string, data: string) => void
  onExit: (id: string, code: number, reason?: string) => void
}

export class PtyManager {
  private ptys = new Map<string, pty.IPty>()
  constructor(private sinks: PtySinks) {}

  spawn(o: SpawnOpts): void {
    const { file, args } = resolveLauncher(o.command, o.args ?? [])
    try {
      const p = pty.spawn(file, args, {
        name: 'xterm-256color',
        cols: o.cols,
        rows: o.rows,
        cwd: o.cwd,
        env: { ...process.env, ...(o.env ?? {}) }, // manter SystemRoot/Path
        useConptyDll: true,
        handleFlowControl: true,
      })
      p.onData((d) => this.sinks.onData(o.id, d))
      p.onExit(({ exitCode }) => {
        this.ptys.delete(o.id)
        this.sinks.onExit(o.id, exitCode, undefined)
      })
      this.ptys.set(o.id, p)
    } catch (err) {
      this.sinks.onExit(o.id, 1, err instanceof Error ? err.message : String(err))
    }
  }

  write(id: string, data: string): void { this.ptys.get(id)?.write(data) }
  resize(id: string, cols: number, rows: number): void { this.ptys.get(id)?.resize(cols, rows) }
  kill(id: string): void { this.ptys.get(id)?.kill(); this.ptys.delete(id) }
  killAll(): void { for (const p of this.ptys.values()) p.kill(); this.ptys.clear() }
}
