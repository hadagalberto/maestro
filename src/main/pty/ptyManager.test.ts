import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node-pty', () => ({ spawn }))
vi.mock('./resolveLauncher', () => ({
  resolveLauncher: (cmd: string, args: string[]) => ({ file: cmd, args }),
}))
import { PtyManager } from './ptyManager'

function fakePty() {
  const ee = new EventEmitter()
  return Object.assign(ee, {
    onData: (cb: (d: string) => void) => ee.on('data', cb),
    onExit: (cb: (e: { exitCode: number }) => void) => ee.on('exit', cb),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
  })
}

beforeEach(() => spawn.mockReset())

describe('PtyManager', () => {
  it('spawna e encaminha data via sink por id', () => {
    const p = fakePty(); spawn.mockReturnValue(p)
    const onData = vi.fn(); const onExit = vi.fn()
    const mgr = new PtyManager({ onData, onExit })
    mgr.spawn({ id: 't1', command: 'bash', cwd: '/tmp', cols: 80, rows: 24 })
    expect(spawn).toHaveBeenCalledWith('bash', [], expect.objectContaining({ cols: 80, rows: 24 }))
    ;(p as unknown as EventEmitter).emit('data', 'hi')
    expect(onData).toHaveBeenCalledWith('t1', 'hi')
  })

  it('encaminha write/resize/kill ao pty certo', () => {
    const p = fakePty(); spawn.mockReturnValue(p)
    const mgr = new PtyManager({ onData: vi.fn(), onExit: vi.fn() })
    mgr.spawn({ id: 't1', command: 'bash', cwd: '/tmp', cols: 80, rows: 24 })
    mgr.write('t1', 'ls')
    mgr.resize('t1', 100, 40)
    mgr.kill('t1')
    expect(p.write).toHaveBeenCalledWith('ls')
    expect(p.resize).toHaveBeenCalledWith(100, 40)
    expect(p.kill).toHaveBeenCalled()
  })

  it('emite exit e remove o pty do mapa', () => {
    const p = fakePty(); spawn.mockReturnValue(p)
    const onExit = vi.fn()
    const mgr = new PtyManager({ onData: vi.fn(), onExit })
    mgr.spawn({ id: 't1', command: 'bash', cwd: '/tmp', cols: 80, rows: 24 })
    ;(p as unknown as EventEmitter).emit('exit', { exitCode: 0 })
    expect(onExit).toHaveBeenCalledWith('t1', 0, undefined)
    mgr.write('t1', 'x') // não deve lançar
  })

  it('emite exit com motivo quando spawn lança', () => {
    spawn.mockImplementation(() => { throw new Error('spawn ENOENT') })
    const onExit = vi.fn()
    const mgr = new PtyManager({ onData: vi.fn(), onExit })
    mgr.spawn({ id: 't1', command: 'nope', cwd: '/tmp', cols: 80, rows: 24 })
    expect(onExit).toHaveBeenCalledWith('t1', 1, expect.stringContaining('ENOENT'))
    // Vitest 4: clear the throwing implementation before teardown so the
    // caught mock-throw is not re-surfaced as an unhandled error.
    spawn.mockReset()
  })

  it('killAll mata todos', () => {
    const a = fakePty(); const b = fakePty()
    spawn.mockReturnValueOnce(a).mockReturnValueOnce(b)
    const mgr = new PtyManager({ onData: vi.fn(), onExit: vi.fn() })
    mgr.spawn({ id: 'a', command: 'bash', cwd: '/tmp', cols: 80, rows: 24 })
    mgr.spawn({ id: 'b', command: 'bash', cwd: '/tmp', cols: 80, rows: 24 })
    mgr.killAll()
    expect(a.kill).toHaveBeenCalled()
    expect(b.kill).toHaveBeenCalled()
  })
})
