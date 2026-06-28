import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Mailbox } from './mailbox'
import type { RendererBridge } from './rendererBridge'
import type { Discussion } from '@shared/discussion/types'
import type { ProfileEntry } from '@shared/types'

export interface QueenToolDeps {
  discussionRunner: { start(a: { topic: string; templateKind: Discussion['templateKind']; orchestratorProfileId: string; participantProfileIds: string[]; autonomous: boolean }): Promise<{ id: string }> }
  discussionStore: { list(): Discussion[]; get(id: string): Discussion | null }
  effectiveEntries: () => Record<string, ProfileEntry>
  currentProject: () => string | null
  isTrusted: (root: string) => boolean
  mailbox: Mailbox
  bridge: Pick<RendererBridge, 'request'>
  notify: (title: string, body: string) => void
}

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }
type Handler = (args: Record<string, unknown>) => Promise<ToolResult> | ToolResult
const ok = (text: string): ToolResult => ({ content: [{ type: 'text', text }] })
const err = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true })
const json = (v: unknown): ToolResult => ok(JSON.stringify(v))

export function registerQueenTools(mcp: McpServer, deps: QueenToolDeps): Record<string, Handler> {
  const handlers: Record<string, Handler> = {}
  const reg = (name: string, def: { title: string; description: string; inputSchema: Record<string, z.ZodTypeAny> }, h: Handler) => {
    handlers[name] = h
    mcp.registerTool(name, def, h as never)
  }
  const trusted = (): boolean => { const root = deps.currentProject(); return root == null || deps.isTrusted(root) }
  const trustErr = () => err('workspace not trusted — trust the project in Maestro before running this tool')

  reg('list_terminals', { title: 'List terminals', description: 'List open terminal panes', inputSchema: {} },
    async () => json(await deps.bridge.request('terminals.list', {})))

  reg('spawn_terminal', { title: 'Spawn terminal', description: 'Open a new terminal pane from a profile id or raw command', inputSchema: { profileId: z.string().optional(), command: z.string().optional(), name: z.string().optional() } },
    async (a) => { if (!trusted()) return trustErr(); return json(await deps.bridge.request('terminals.spawn', { profileId: a.profileId, command: a.command, name: a.name })) })

  reg('kill_terminal', { title: 'Kill terminal', description: 'Close a terminal pane by id', inputSchema: { id: z.string() } },
    async (a) => json(await deps.bridge.request('terminals.kill', { id: a.id })))

  reg('read_terminal', { title: 'Read terminal', description: 'Read recent output of a terminal pane', inputSchema: { id: z.string(), maxChars: z.number().int().positive().optional() } },
    async (a) => ok(String(await deps.bridge.request('terminals.read', { id: a.id, maxChars: a.maxChars }))))

  reg('write_terminal', { title: 'Write terminal', description: 'Write input (e.g. a command) to a terminal pane', inputSchema: { id: z.string(), data: z.string() } },
    async (a) => { if (!trusted()) return trustErr(); return json(await deps.bridge.request('terminals.write', { id: a.id, data: a.data })) })

  reg('list_profiles', { title: 'List profiles', description: 'List available CLI profiles', inputSchema: {} },
    () => json(Object.entries(deps.effectiveEntries()).map(([id, e]) => ({ id, name: e.name ?? id, command: e.command }))))

  reg('start_discussion', { title: 'Start discussion', description: 'Start a multi-agent discussion', inputSchema: { topic: z.string(), templateKind: z.enum(['decision', 'brainstorm', 'review', 'plan', 'dev-squad', 'custom']), orchestratorProfileId: z.string(), participantProfileIds: z.array(z.string()), autonomous: z.boolean().optional() } },
    async (a) => { if (!trusted()) return trustErr(); const r = await deps.discussionRunner.start({ topic: a.topic as string, templateKind: a.templateKind as Discussion['templateKind'], orchestratorProfileId: a.orchestratorProfileId as string, participantProfileIds: a.participantProfileIds as string[], autonomous: (a.autonomous as boolean) ?? true }); return json(r) })

  reg('get_discussion', { title: 'Get discussion', description: 'Get a discussion transcript + cards', inputSchema: { id: z.string() } },
    (a) => { const d = deps.discussionStore.get(a.id as string); return d ? json({ id: d.id, topic: d.topic, status: d.status, transcript: d.transcript.map((t) => ({ role: t.role, text: t.text })), cards: d.cards }) : err('not found') })

  reg('list_discussions', { title: 'List discussions', description: 'List recent discussions', inputSchema: {} },
    () => json(deps.discussionStore.list().map((d) => ({ id: d.id, topic: d.topic, status: d.status }))))

  reg('send_message', { title: 'Send message', description: 'Send a message to another agent', inputSchema: { from: z.string(), to: z.string(), text: z.string() } },
    (a) => json(deps.mailbox.send({ from: a.from as string, to: a.to as string, text: a.text as string })))

  reg('read_inbox', { title: 'Read inbox', description: 'Read messages addressed to an agent', inputSchema: { agent: z.string(), unreadOnly: z.boolean().optional() } },
    (a) => json(deps.mailbox.inbox(a.agent as string, { unreadOnly: a.unreadOnly as boolean, markRead: true })))

  reg('notify', { title: 'Notify', description: 'Show a native notification to the user', inputSchema: { title: z.string(), body: z.string() } },
    (a) => { deps.notify(a.title as string, a.body as string); return ok('notified') })

  reg('project_info', { title: 'Project info', description: 'Current project path and trust status', inputSchema: {} },
    () => { const root = deps.currentProject(); return json({ currentProject: root, trusted: root == null ? true : deps.isTrusted(root) }) })

  return handlers
}
