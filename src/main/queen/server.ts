import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { QueenAuth } from './auth'
import { registerQueenTools, type QueenToolDeps } from './tools'

const MAX_BODY = 4 * 1024 * 1024

interface Session { transport: InstanceType<typeof StreamableHTTPServerTransport>; mcp: McpServer }

export interface QueenHandle { url: string; token: string; port: number; close: () => Promise<void> }

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  let raw = ''; let size = 0
  for await (const c of req) { size += (c as Buffer).length; if (size > MAX_BODY) throw new Error('body too large'); raw += c }
  return raw ? JSON.parse(raw) : undefined
}

export async function startQueen(deps: QueenToolDeps, auth = new QueenAuth(), opts: { port?: number } = {}): Promise<QueenHandle> {
  const sessions = new Map<string, Session>()
  let port = 0

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/mcp') { res.writeHead(404).end(); return }
      if (!auth.hostAllowed(req.headers.host, port) || !auth.originAllowed(req.headers.origin as string | undefined)) { res.writeHead(403).end(); return }
      if (!auth.checkToken(req.headers.authorization)) { res.writeHead(401).end(); return }

      const sid = req.headers['mcp-session-id'] as string | undefined
      const body = req.method === 'POST' ? await readBody(req) : undefined

      let transport: Session['transport']
      if (sid && sessions.has(sid)) {
        transport = sessions.get(sid)!.transport
      } else if (!sid && req.method === 'POST' && (body as { method?: string } | undefined)?.method === 'initialize') {
        const mcp = new McpServer({ name: 'maestro-queen', version: '0.1.0' }, { capabilities: { tools: {} } })
        registerQueenTools(mcp, deps)
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => { sessions.set(id, { transport, mcp }) },
        })
        transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId) }
        await mcp.connect(transport)
        await transport.handleRequest(req, res, body)
        return
      } else {
        res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'No valid session' }, id: null }))
        return
      }
      await transport.handleRequest(req, res, body)
    } catch (e) {
      if (!res.headersSent) res.writeHead((e as Error).message === 'body too large' ? 413 : 500).end()
    }
  })

  // porta fixa (opts.port) com fallback p/ efêmera se estiver ocupada — nunca falha em subir
  const listen = (p: number) => new Promise<void>((res, rej) => {
    const onErr = (e: NodeJS.ErrnoException) => rej(e)
    server.once('error', onErr)
    server.listen(p, '127.0.0.1', () => { server.off('error', onErr); res() })
  })
  const desired = opts.port ?? 0
  try { await listen(desired) }
  catch (e) {
    if (desired !== 0 && (e as NodeJS.ErrnoException).code === 'EADDRINUSE') await listen(0)
    else throw e
  }
  port = (server.address() as import('node:net').AddressInfo).port
  const url = `http://127.0.0.1:${port}/mcp`

  return {
    url, token: auth.token, port,
    close: async () => {
      for (const s of sessions.values()) { try { await s.transport.close() } catch { /* ignore */ } }
      sessions.clear()
      await new Promise<void>((r) => server.close(() => r()))
    },
  }
}
