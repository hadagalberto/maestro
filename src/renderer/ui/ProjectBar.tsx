import { useState } from 'react'
import { useProject } from '../store/projectStore'
import { basename } from '../util/basename'

export function ProjectBar() {
  const current = useProject((s) => s.currentProject)
  const recent = useProject((s) => s.recentProjects)
  const apply = useProject((s) => s.apply)
  const [open, setOpen] = useState(false)

  async function openDialog() {
    const s = await window.term.invoke('project:open', undefined)
    if (s) apply(s); setOpen(false)
  }
  async function openPath(p: string) {
    const s = await window.term.invoke('project:openPath', { path: p })
    apply(s); setOpen(false)
  }

  return (
    <div className="relative flex items-center gap-2 border-b border-zinc-800 bg-zinc-950 px-3 py-1">
      <button onClick={() => setOpen((v) => !v)} className="rounded px-2 py-0.5 text-xs text-zinc-200 hover:bg-zinc-800">
        {current ? basename(current) : 'Abrir projeto'} ▾
      </button>
      {open && (
        <div className="absolute left-2 top-7 z-50 w-72 rounded border border-zinc-700 bg-zinc-900 p-1 shadow-xl" onMouseLeave={() => setOpen(false)}>
          <button onClick={openDialog} className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-zinc-800">Abrir pasta…</button>
          {recent.length > 0 && <div className="mt-1 border-t border-zinc-800 px-2 py-1 text-[10px] uppercase text-zinc-600">Recentes</div>}
          {recent.map((p) => (
            <button key={p} onClick={() => openPath(p)} className="block w-full truncate rounded px-2 py-1 text-left text-xs text-zinc-300 hover:bg-zinc-800" title={p}>{basename(p)}</button>
          ))}
        </div>
      )}
    </div>
  )
}
