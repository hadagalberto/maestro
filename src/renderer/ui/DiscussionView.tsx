import { useEffect } from 'react'
import { useDiscussions } from '../store/discussionStore'

export function DiscussionView({ id }: { id: string }) {
  const active = useDiscussions((s) => s.active)
  const open = useDiscussions((s) => s.open)
  const applyEvent = useDiscussions((s) => s.applyEvent)

  useEffect(() => {
    void open(id)
    const off = window.term.onDiscussionEvent(id, (ev) => applyEvent(ev))
    return off
  }, [id, open, applyEvent])

  if (!active || active.id !== id) return <div className="p-4 text-sm text-zinc-500">carregando…</div>
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <span className="text-sm font-medium">{active.topic}</span>
        <span className="rounded bg-zinc-800 px-1.5 text-[10px] text-zinc-400">{active.templateKind}</span>
        <span className="text-[10px] text-zinc-500">{active.status}</span>
        {active.status === 'running' && <button onClick={() => window.term.invoke('discussion:abort', { id })} className="ml-auto rounded bg-red-900/50 px-2 text-xs text-red-200">abortar</button>}
        {active.status === 'awaiting-approval' && <button onClick={() => window.term.invoke('discussion:approve', { id, approve: true })} className="ml-auto rounded bg-amber-600 px-2 text-xs text-white">aprovar</button>}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        {active.transcript.map((t) => (
          <div key={t.id} className={`rounded border p-2 ${t.isSynthesis ? 'border-amber-700/40 bg-amber-950/20' : 'border-zinc-800'}`}>
            <div className="mb-1 text-[11px] text-zinc-400">{t.role}{t.error ? ' · erro' : ''}</div>
            <div className="whitespace-pre-wrap text-sm">{t.error ? `⚠ ${t.error}` : t.text}</div>
          </div>
        ))}
        {active.cards.map((c, i) => (
          <div key={`c${i}`} className="rounded border border-sky-700/50 bg-sky-950/20 p-3">
            <div className="mb-1 text-[10px] uppercase text-sky-300">{c.kind}</div>
            <div className="font-semibold">{c.title}</div>
            <div className="whitespace-pre-wrap text-sm">{c.body}</div>
            {c.dissents && c.dissents.length > 0 && <div className="mt-2 text-xs text-amber-300">Dissensos: {c.dissents.join('; ')}</div>}
            {c.actions && c.actions.length > 0 && <ul className="mt-2 list-disc pl-4 text-xs">{c.actions.map((a, j) => <li key={j}>{a.owner ? `${a.owner}: ` : ''}{a.task}</li>)}</ul>}
          </div>
        ))}
      </div>
    </div>
  )
}
