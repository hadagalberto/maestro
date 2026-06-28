import { describe, it, expect } from 'vitest'
import { captureOnce, CaptureError } from './captureOnce'

const node = process.execPath // a real, always-present executable

describe('captureOnce', () => {
  it('captura stdout de um processo real', async () => {
    const r = await captureOnce({ command: node, args: ['-e', "process.stdout.write('hello')"], cwd: process.cwd() })
    expect(r.stdout).toBe('hello')
    expect(r.code).toBe(0)
  })
  it('separa stderr de stdout', async () => {
    const r = await captureOnce({ command: node, args: ['-e', "process.stdout.write('OUT');process.stderr.write('ERR')"], cwd: process.cwd() })
    expect(r.stdout).toBe('OUT'); expect(r.stderr).toBe('ERR')
  })
  it('timeout mata o processo e rejeita', async () => {
    await expect(captureOnce({ command: node, args: ['-e', 'setTimeout(()=>{}, 60000)'], cwd: process.cwd(), timeoutMs: 300 }))
      .rejects.toMatchObject({ reason: 'timeout' })
  })
  it('abort via signal rejeita aborted', async () => {
    const ac = new AbortController()
    const p = captureOnce({ command: node, args: ['-e', 'setTimeout(()=>{}, 60000)'], cwd: process.cwd(), signal: ac.signal })
    setTimeout(() => ac.abort(), 100)
    await expect(p).rejects.toMatchObject({ reason: 'aborted' })
  })
  it('feeds stdin', async () => {
    const r = await captureOnce({ command: node, args: ['-e', "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(d.toUpperCase()))"], cwd: process.cwd(), stdin: 'abc' })
    expect(r.stdout).toBe('ABC')
  })
})

// Ensure the named export CaptureError is part of the public API surface (type-only reference).
export type _CaptureErrorRef = typeof CaptureError
