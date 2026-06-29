import { useGrid } from '../store/gridStore'
import type { PaneConfig } from '@shared/types'

export function AgentTreeView() {
  const panes = useGrid((s) => s.panes)
  const exited = useGrid((s) => s.exited)
  const active = useGrid((s) => s.activePaneId)
  const setActive = useGrid((s) => s.setActive)

  const ids = new Set(panes.map((p) => p.id))
  const childrenOf = (pid: string | undefined) => panes.filter((p) => (p.parentId && ids.has(p.parentId) ? p.parentId : undefined) === pid)

  const visited = new Set<string>()
  const row = (p: PaneConfig, depth: number) => {
    if (visited.has(p.id)) return null
    visited.add(p.id)
    const done = p.id in exited
    return (
      <div key={p.id}>
        <div onClick={() => setActive(p.id)}
          className={`flex items-center gap-2 rounded px-2 py-1 ${active === p.id ? 'bg-zinc-800' : ''}`}
          style={{ paddingLeft: 8 + depth * 14 }}>
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: done ? '#52525b' : (p.color ?? '#3fb950') }} title={done ? `exited ${exited[p.id]}` : 'running'} />
          <span className="flex-1 truncate">{p.name}</span>
          <button onClick={(e) => { e.stopPropagation(); const ids = useGrid.getState().removePaneTree(p.id); for (const id of ids) void window.term.invoke('pty:kill', { id }) }} className="text-zinc-500 hover:text-red-400">×</button>
        </div>
        {childrenOf(p.id).map((c) => row(c, depth + 1))}
      </div>
    )
  }

  return (
    <aside className="w-56 shrink-0 overflow-auto border-r border-zinc-800 p-2 text-sm">
      <div className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Agentes</div>
      {panes.length === 0 && <div className="text-xs text-zinc-600">nenhum terminal</div>}
      {childrenOf(undefined).map((p) => row(p, 0))}
    </aside>
  )
}
