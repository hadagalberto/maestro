import { useEffect, useState } from 'react'
import { usePins } from '../store/pinsStore'

export function PinsPanel({ onClose }: { onClose: () => void }) {
  const { pins, notes, refresh, addPin, toggle, remove, setNotes } = usePins()
  const [draft, setDraft] = useState('')
  useEffect(() => { void refresh() }, [refresh])
  return (
    <div className="absolute inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="flex h-full w-[420px] flex-col border-l border-zinc-700 bg-zinc-900 text-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center border-b border-zinc-800 px-3 py-2"><span className="font-medium">Pins &amp; Notes</span><button onClick={onClose} className="ml-auto text-xs text-zinc-400">fechar</button></div>
        <div className="border-b border-zinc-800 p-2">
          <div className="mb-1 text-[10px] uppercase text-zinc-500">Pins</div>
          {pins.length === 0 && <div className="px-1 text-xs text-zinc-600">nenhum pin</div>}
          {pins.map((p) => (
            <div key={p.id} className="flex items-center gap-2 px-1 py-0.5">
              <input type="checkbox" checked={p.done} onChange={(e) => void toggle(p.id, e.target.checked)} />
              <span className={`flex-1 truncate ${p.done ? 'text-zinc-500 line-through' : ''}`}>{p.text}</span>
              <button onClick={() => void remove(p.id)} className="text-zinc-600 hover:text-red-400">×</button>
            </div>
          ))}
          <form onSubmit={(e) => { e.preventDefault(); void addPin(draft); setDraft('') }} className="mt-1 flex gap-1">
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="+ pin" className="flex-1 rounded bg-zinc-800 px-2 py-0.5 text-xs" />
            <button className="rounded bg-sky-700 px-2 text-xs text-white">add</button>
          </form>
        </div>
        <div className="flex min-h-0 flex-1 flex-col p-2">
          <div className="mb-1 text-[10px] uppercase text-zinc-500">Notes</div>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="scratchpad do projeto…" className="min-h-0 flex-1 resize-none rounded bg-zinc-800 p-2 font-mono text-xs" />
        </div>
      </div>
    </div>
  )
}
