export type AgentStatus = 'running' | 'exited'
export interface AgentNode { id: string; name: string; command: string; parentId?: string; status: AgentStatus; exitCode?: number; createdAt: number }
export interface AgentTreeNode extends AgentNode { children: AgentTreeNode[] }
export type AwaitResult = { exitCode: number } | 'timeout' | 'gone'

export class AgentTree {
  private nodes = new Map<string, AgentNode>()
  private waiters = new Map<string, ((r: AwaitResult) => void)[]>()
  constructor(private now: () => number = () => Date.now()) {}

  open(n: { id: string; name: string; command: string; parentId?: string }): void {
    this.nodes.set(n.id, { id: n.id, name: n.name, command: n.command, parentId: n.parentId, status: 'running', createdAt: this.now() })
  }

  close(id: string): void {
    this.nodes.delete(id)
    const w = this.waiters.get(id)
    if (w) { for (const r of w) r('gone'); this.waiters.delete(id) }
  }

  markExited(id: string, code: number): { parentId?: string } | null {
    const n = this.nodes.get(id)
    if (!n) return null
    n.status = 'exited'; n.exitCode = code
    const w = this.waiters.get(id)
    if (w) { for (const r of w) r({ exitCode: code }); this.waiters.delete(id) }
    return { parentId: n.parentId }
  }

  get(id: string): AgentNode | undefined { return this.nodes.get(id) }

  tree(): AgentTreeNode[] {
    const ids = new Set(this.nodes.keys())
    const byParent = new Map<string | undefined, AgentNode[]>()
    for (const n of this.nodes.values()) {
      const key = n.parentId && ids.has(n.parentId) ? n.parentId : undefined
      const list = byParent.get(key) ?? []
      list.push(n); byParent.set(key, list)
    }
    const visited = new Set<string>()
    const build = (n: AgentNode): AgentTreeNode => {
      if (visited.has(n.id)) return { ...n, children: [] }
      visited.add(n.id)
      return { ...n, children: (byParent.get(n.id) ?? []).map(build) }
    }
    return (byParent.get(undefined) ?? []).map(build)
  }

  awaitExit(id: string, timeoutMs: number): Promise<AwaitResult> {
    const n = this.nodes.get(id)
    if (!n) return Promise.resolve('gone')
    if (n.status === 'exited') return Promise.resolve({ exitCode: n.exitCode ?? 0 })
    return new Promise<AwaitResult>((resolve) => {
      const list = this.waiters.get(id) ?? []
      const wrap = (r: AwaitResult) => {
        clearTimeout(timer)
        const arr = this.waiters.get(id)
        if (arr) { const i = arr.indexOf(wrap); if (i >= 0) arr.splice(i, 1) }
        resolve(r)
      }
      const timer = setTimeout(() => wrap('timeout'), timeoutMs)
      list.push(wrap); this.waiters.set(id, list)
    })
  }
}
