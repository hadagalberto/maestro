import { describe, it, expect, vi } from 'vitest'
import { RendererBridge } from './rendererBridge'

function fakeWebContents() {
  return { isDestroyed: () => false, send: vi.fn() }
}

describe('RendererBridge', () => {
  it('request envia queen:req e resolve quando chega resposta', async () => {
    const wc = fakeWebContents()
    const bridge = new RendererBridge(() => wc as never, () => 'req1')
    const p = bridge.request('terminals.list', {})
    expect(wc.send).toHaveBeenCalledWith('queen:req', { reqId: 'req1', op: 'terminals.list', args: {} })
    bridge.handleResponse({ reqId: 'req1', ok: true, result: [{ id: 't1' }] })
    await expect(p).resolves.toEqual([{ id: 't1' }])
  })
  it('rejeita em erro', async () => {
    const wc = fakeWebContents()
    const bridge = new RendererBridge(() => wc as never, () => 'req2')
    const p = bridge.request('terminals.kill', { id: 'x' })
    bridge.handleResponse({ reqId: 'req2', ok: false, error: 'boom' })
    await expect(p).rejects.toThrow('boom')
  })
  it('sem janela -> rejeita', async () => {
    const bridge = new RendererBridge(() => null, () => 'req3')
    await expect(bridge.request('terminals.list', {})).rejects.toThrow(/no window/)
  })
  it('timeout rejeita', async () => {
    const wc = fakeWebContents()
    const bridge = new RendererBridge(() => wc as never, () => 'req4')
    await expect(bridge.request('terminals.list', {}, 10)).rejects.toThrow(/timeout/)
  })
})
