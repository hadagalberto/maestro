import { describe, it, expect, vi } from 'vitest'

const { mockStore, data } = vi.hoisted(() => {
  const data: Record<string, unknown> = {}
  const mockStore = { get: (k: string) => data[k], set: vi.fn((k: string, v: unknown) => { data[k] = v }) }
  return { mockStore, data }
})
vi.mock('electron-store', () => ({ default: vi.fn(function () { return mockStore }) }))

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { startQueen } from './server'
import { QueenAuth } from './auth'
import { Mailbox } from './mailbox'
import { AgentTree } from './agentTree'
import { PinsStore } from '../pins/pinsStore'

function deps(notify = vi.fn()) {
  return {
    discussionRunner: { start: vi.fn().mockResolvedValue({ id: 'd1' }) },
    discussionStore: { list: () => [{ id: 'd1', topic: 'T', status: 'done' } as never], get: () => null },
    effectiveEntries: () => ({ claude: { command: 'claude' } }),
    currentProject: () => null,
    isTrusted: () => true,
    mailbox: new Mailbox(() => 'm1', () => 1),
    bridge: { request: vi.fn().mockResolvedValue('') },
    notify,
    agentTree: new AgentTree(() => 1),
    pins: new PinsStore(),
    onPinsChanged: vi.fn(),
  }
}

async function connect(url: string, token: string) {
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } })
  const client = new Client({ name: 'test', version: '1' })
  await client.connect(transport)
  return { client, transport }
}

describe('Queen integration (real MCP client)', () => {
  it('lista tools e chama main-owned tools via Streamable HTTP + bearer', async () => {
    const notify = vi.fn()
    const auth = new QueenAuth('tok')
    const h = await startQueen(deps(notify), auth)
    try {
      const { client, transport } = await connect(h.url, 'tok')
      const tools = await client.listTools()
      expect(tools.tools.map((t) => t.name)).toContain('notify')
      expect(tools.tools.length).toBe(24)

      await client.callTool({ name: 'notify', arguments: { title: 'T', body: 'B' } })
      expect(notify).toHaveBeenCalledWith('T', 'B')

      await client.callTool({ name: 'send_message', arguments: { from: 'a', to: 'b', text: 'hi' } })
      const inbox = await client.callTool({ name: 'read_inbox', arguments: { agent: 'b' } })
      expect((inbox.content as { text: string }[])[0].text).toContain('hi')

      const list = await client.callTool({ name: 'list_discussions', arguments: {} })
      expect((list.content as { text: string }[])[0].text).toContain('d1')

      await transport.close()
    } finally { await h.close() }
  })

  it('list_agents + await_agent via client', async () => {
    const d = deps()
    d.agentTree.open({ id: 'root', name: 'root', command: 'x' })
    const auth = new QueenAuth('tok')
    const h = await startQueen(d, auth)
    try {
      const { client, transport } = await connect(h.url, 'tok')
      const list = await client.callTool({ name: 'list_agents', arguments: {} })
      expect((list.content as { text: string }[])[0].text).toContain('root')
      const p = client.callTool({ name: 'await_agent', arguments: { id: 'root', timeoutMs: 5000 } })
      d.agentTree.markExited('root', 0)
      const r = await p
      expect((r.content as { text: string }[])[0].text).toContain('"exitCode":0')
      await transport.close()
    } finally { await h.close() }
  })

  it('rejeita sem token', async () => {
    const h = await startQueen(deps(), new QueenAuth('tok'))
    try {
      const transport = new StreamableHTTPClientTransport(new URL(h.url)) // no auth header
      const client = new Client({ name: 'test', version: '1' })
      await expect(client.connect(transport)).rejects.toBeTruthy()
    } finally { await h.close() }
  })
})
