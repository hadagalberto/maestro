import { useEffect } from 'react'
import { useDiscussions } from '../store/discussionStore'

export function DiscussionList({ onOpen }: { onOpen: (id: string) => void }) {
  const list = useDiscussions((s) => s.list)
  const refresh = useDiscussions((s) => s.refresh)
  useEffect(() => { void refresh() }, [refresh])
  return (
    <div className="w-72 shrink-0 border-l border-zinc-800 p-2 text-sm">
      <div className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Discussões</div>
      {list.length === 0 && <div className="text-xs text-zinc-600">nenhuma</div>}
      {list.map((d) => (
        <div key={d.id} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-zinc-800" onClick={() => onOpen(d.id)}>
          <span className="flex-1 truncate">{d.topic}</span>
          <span className="text-[10px] text-zinc-500">{d.status}</span>
          <button onClick={(e) => { e.stopPropagation(); void window.term.invoke('discussion:delete', { id: d.id }).then(() => refresh()) }} className="text-zinc-600 hover:text-red-400">×</button>
        </div>
      ))}
    </div>
  )
}
