import { useGrid } from '../store/gridStore'

export function Sidebar() {
  const panes = useGrid((s) => s.panes)
  const active = useGrid((s) => s.activePaneId)
  const setActive = useGrid((s) => s.setActive)
  const removePane = useGrid((s) => s.removePane)
  return (
    <aside className="w-56 shrink-0 border-r border-zinc-800 p-2 text-sm">
      <div className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Terminais</div>
      {panes.length === 0 && <div className="text-xs text-zinc-600">nenhum terminal</div>}
      {panes.map((p) => (
        <div key={p.id} onClick={() => setActive(p.id)}
          className={`flex items-center justify-between rounded px-2 py-1 ${active === p.id ? 'bg-zinc-800' : ''}`}>
          <span className="truncate">{p.name}</span>
          <button onClick={(e) => { e.stopPropagation(); removePane(p.id); void window.term.invoke('pty:kill', { id: p.id }) }}
            className="text-zinc-500 hover:text-red-400">×</button>
        </div>
      ))}
    </aside>
  )
}
