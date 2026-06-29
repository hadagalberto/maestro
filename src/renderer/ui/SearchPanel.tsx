import { useState } from 'react'
import { useFiles } from '../store/filesStore'

export function SearchPanel({ onClose }: { onClose: () => void }) {
  const { results, searching, search, openFile } = useFiles()
  const [q, setQ] = useState('')
  const [opts, setOpts] = useState({ regex: false, caseSensitive: false, wholeWord: false })
  const toggle = (k: keyof typeof opts) => setOpts((o) => ({ ...o, [k]: !o[k] }))
  return (
    <div className="absolute inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="flex h-full w-[480px] flex-col border-l border-zinc-700 bg-zinc-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-1 border-b border-zinc-800 p-2">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void search(q, opts) }} placeholder="buscar nos arquivos…" className="flex-1 rounded bg-zinc-800 px-2 py-1 text-sm outline-none" />
          <button onClick={() => toggle('caseSensitive')} className={`rounded px-1 text-xs ${opts.caseSensitive ? 'bg-sky-700 text-white' : 'bg-zinc-800 text-zinc-400'}`} title="case">Aa</button>
          <button onClick={() => toggle('wholeWord')} className={`rounded px-1 text-xs ${opts.wholeWord ? 'bg-sky-700 text-white' : 'bg-zinc-800 text-zinc-400'}`} title="whole word">W</button>
          <button onClick={() => toggle('regex')} className={`rounded px-1 text-xs ${opts.regex ? 'bg-sky-700 text-white' : 'bg-zinc-800 text-zinc-400'}`} title="regex">.*</button>
          <button onClick={() => void search(q, opts)} className="rounded bg-emerald-700 px-2 text-xs text-white">buscar</button>
          <button onClick={onClose} className="text-xs text-zinc-400">×</button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-1 text-xs">
          {searching && <div className="px-2 py-1 text-zinc-500">buscando…</div>}
          {!searching && results.length === 0 && <div className="px-2 py-1 text-zinc-600">sem resultados</div>}
          {results.map((f) => (
            <div key={f.path} className="mb-1">
              <div className="cursor-pointer px-2 py-0.5 font-mono text-zinc-300 hover:bg-zinc-800" onClick={() => void openFile(f.path)}>{f.path} <span className="text-zinc-600">({f.matches.length})</span></div>
              {f.matches.slice(0, 20).map((m, i) => (
                <div key={i} className="cursor-pointer truncate pl-6 pr-2 font-mono text-zinc-500 hover:bg-zinc-800" onClick={() => void openFile(f.path)}><span className="text-zinc-600">{m.line}</span> {m.text.trim()}</div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
