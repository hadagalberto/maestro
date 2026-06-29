import { describe, it, expect, vi } from 'vitest'

const { mockStore, data } = vi.hoisted(() => {
  const data: Record<string, unknown> = {}
  const mockStore = { get: (k: string) => data[k], set: vi.fn((k: string, v: unknown) => { data[k] = v }) }
  return { mockStore, data }
})
vi.mock('electron-store', () => ({ default: vi.fn(function () { return mockStore }) }))

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerQueenTools } from './tools'
import { Mailbox } from './mailbox'
import { AgentTree } from './agentTree'
import { PinsStore } from '../pins/pinsStore'

function deps(over: Partial<Parameters<typeof registerQueenTools>[1]> = {}) {
  return {
    discussionRunner: { start: vi.fn().mockResolvedValue({ id: 'd1' }) },
    discussionStore: { list: () => [], get: () => null },
    effectiveEntries: () => ({ claude: { command: 'claude' } }),
    currentProject: () => null,
    isTrusted: () => true,
    mailbox: new Mailbox(() => 'm1', () => 1),
    bridge: { request: vi.fn().mockResolvedValue([{ id: 't1' }]) },
    notify: vi.fn(),
    agentTree: new AgentTree(() => 1),
    pins: new PinsStore(),
    onPinsChanged: vi.fn(),
    ...over,
  } as Parameters<typeof registerQueenTools>[1]
}

// helper: find a registered tool's handler via the McpServer internal registry by calling listTools through a connected client is heavy;
// instead registerQueenTools returns a map of name->handler for direct unit testing.
describe('registerQueenTools', () => {
  it('registra as 24 tools e devolve o mapa de handlers', () => {
    const mcp = new McpServer({ name: 't', version: '1' })
    const handlers = registerQueenTools(mcp, deps())
    expect(Object.keys(handlers).length).toBe(24)
    expect(handlers['notify']).toBeTypeOf('function')
  })
  it('notify chama deps.notify e retorna texto', async () => {
    const mcp = new McpServer({ name: 't', version: '1' })
    const d = deps(); const handlers = registerQueenTools(mcp, d)
    const r = await handlers['notify']({ title: 'T', body: 'B' })
    expect(d.notify).toHaveBeenCalledWith('T', 'B')
    expect(r.isError).toBeFalsy()
  })
  it('send_message + read_inbox via mailbox', async () => {
    const mcp = new McpServer({ name: 't', version: '1' })
    const d = deps(); const handlers = registerQueenTools(mcp, d)
    await handlers['send_message']({ from: 'a', to: 'b', text: 'hi' })
    const r = await handlers['read_inbox']({ agent: 'b' })
    expect(r.content[0].text).toContain('hi')
  })
  it('spawn_terminal bloqueia em projeto não confiável', async () => {
    const mcp = new McpServer({ name: 't', version: '1' })
    const d = deps({ currentProject: () => '/proj', isTrusted: () => false }); const handlers = registerQueenTools(mcp, d)
    const r = await handlers['spawn_terminal']({ profileId: 'claude' })
    expect(r.isError).toBe(true)
    expect(d.bridge.request).not.toHaveBeenCalled()
  })
  it('spawn_terminal confiável chama bridge', async () => {
    const mcp = new McpServer({ name: 't', version: '1' })
    const d = deps({ currentProject: () => '/proj', isTrusted: () => true }); const handlers = registerQueenTools(mcp, d)
    const r = await handlers['spawn_terminal']({ profileId: 'claude' })
    expect(d.bridge.request).toHaveBeenCalledWith('terminals.spawn', { profileId: 'claude', command: undefined, name: undefined })
    expect(r.isError).toBeFalsy()
  })
  it('project_info reporta path e trust', async () => {
    const mcp = new McpServer({ name: 't', version: '1' })
    const d = deps({ currentProject: () => '/proj', isTrusted: () => false }); const handlers = registerQueenTools(mcp, d)
    const r = await handlers['project_info']({})
    expect(r.isError).toBeFalsy()
    expect(JSON.parse(r.content[0].text)).toMatchObject({ currentProject: '/proj', trusted: false })
  })
  it('list_agents devolve a árvore', () => {
    const mcp = new McpServer({ name: 't', version: '1' })
    const d = deps(); d.agentTree.open({ id: 'r', name: 'r', command: 'x' })
    const handlers = registerQueenTools(mcp, d)
    const r = handlers['list_agents']({})
    expect((r as { content: { text: string }[] }).content[0].text).toContain('"id":"r"')
  })
  it('spawn_sub_agent passa parentId pro bridge', async () => {
    const mcp = new McpServer({ name: 't', version: '1' })
    const d = deps(); const handlers = registerQueenTools(mcp, d)
    await handlers['spawn_sub_agent']({ parentId: 'p1', profileId: 'claude' })
    expect(d.bridge.request).toHaveBeenCalledWith('terminals.spawn', { profileId: 'claude', command: undefined, name: undefined, parentId: 'p1' })
  })
  it('await_agent resolve no exit', async () => {
    const mcp = new McpServer({ name: 't', version: '1' })
    const d = deps(); d.agentTree.open({ id: 'a', name: 'a', command: 'x' })
    ;(d.bridge.request as ReturnType<typeof vi.fn>).mockResolvedValue('out')
    const handlers = registerQueenTools(mcp, d)
    const p = handlers['await_agent']({ id: 'a' })
    d.agentTree.markExited('a', 0)
    const r = await p
    expect((r as { content: { text: string }[] }).content[0].text).toContain('"exitCode":0')
  })
  it('create_pin cria e dispara onPinsChanged', async () => {
    const mcp = new McpServer({ name: 't', version: '1' }); const d = deps({ currentProject: () => '/proj' })
    const handlers = registerQueenTools(mcp, d)
    const r = await handlers['create_pin']({ text: 'x' })
    expect((r as { content: { text: string }[] }).content[0].text).toContain('"text":"x"')
    expect(d.onPinsChanged).toHaveBeenCalled()
  })
  it('set_notes/get_notes round-trip', async () => {
    const mcp = new McpServer({ name: 't', version: '1' }); const d = deps({ currentProject: () => '/proj' })
    const handlers = registerQueenTools(mcp, d)
    await handlers['set_notes']({ notes: 'oi' })
    const r = await handlers['get_notes']({})
    expect((r as { content: { text: string }[] }).content[0].text).toBe('oi')
  })
})
