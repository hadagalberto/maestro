import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import stripAnsi from 'strip-ansi'

export interface CaptureOpts {
  command: string; args?: string[]; cwd: string
  env?: Record<string, string>
  stdin?: string
  timeoutMs?: number
  signal?: AbortSignal
  maxBytes?: number
  stripEscapes?: boolean
}
export interface CaptureResult { stdout: string; stderr: string; code: number | null; signal: NodeJS.Signals | null; durationMs: number }
export class CaptureError extends Error {
  constructor(public reason: 'aborted' | 'timeout' | 'spawn' | 'overflow', msg: string) { super(msg); this.name = 'CaptureError' }
}

export function captureOnce(o: CaptureOpts): Promise<CaptureResult> {
  const t0 = Date.now()
  const timeoutMs = o.timeoutMs ?? 120_000
  const maxBytes = o.maxBytes ?? 25 * 1024 * 1024
  const win = process.platform === 'win32'
  const timeoutSig = AbortSignal.timeout(timeoutMs)
  const combined = o.signal ? AbortSignal.any([o.signal, timeoutSig]) : timeoutSig

  return new Promise<CaptureResult>((resolve, reject) => {
    const child = spawn(o.command, o.args ?? [], {
      cwd: o.cwd, env: { ...process.env, ...(o.env ?? {}) },
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], detached: !win, shell: false,
    })
    let exited = false, settled = false, total = 0
    const outDec = new StringDecoder('utf8'), errDec = new StringDecoder('utf8')
    const out: string[] = [], err: string[] = []

    const treeKill = () => {
      if (exited || child.pid == null) return
      if (win) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
      else { try { process.kill(-child.pid, 'SIGTERM') } catch { /* ignore */ } setTimeout(() => { try { process.kill(-child.pid!, 'SIGKILL') } catch { /* ignore */ } }, 2000) }
    }
    const cleanup = () => combined.removeEventListener('abort', onAbort)
    const fail = (reason: CaptureError['reason'], msg: string) => { if (settled) return; settled = true; cleanup(); treeKill(); reject(new CaptureError(reason, msg)) }
    function onAbort() { const aborted = o.signal?.aborted ?? false; fail(aborted ? 'aborted' : 'timeout', aborted ? 'capture aborted' : `timed out after ${timeoutMs}ms`) }
    combined.addEventListener('abort', onAbort, { once: true })

    child.on('error', (e) => fail('spawn', e.message))
    child.stdout.on('data', (c: Buffer) => { total += c.length; if (total > maxBytes) return fail('overflow', `stdout > ${maxBytes} bytes`); out.push(outDec.write(c)) })
    child.stderr.on('data', (c: Buffer) => { err.push(errDec.write(c)) })
    child.on('exit', () => { exited = true })
    child.on('close', (code, sig) => {
      if (settled) return; settled = true; cleanup()
      out.push(outDec.end()); err.push(errDec.end())
      let stdout = out.join(''), stderr = err.join('')
      if (o.stripEscapes ?? true) { stdout = stripAnsi(stdout); stderr = stripAnsi(stderr) }
      resolve({ stdout, stderr, code, signal: sig, durationMs: Date.now() - t0 })
    })

    if (o.stdin != null) child.stdin.end(o.stdin); else child.stdin.end()
  })
}
