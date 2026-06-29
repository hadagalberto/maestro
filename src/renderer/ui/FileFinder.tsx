import { useEffect, useMemo, useState } from 'react'
import { useFiles } from '../store/filesStore'
import { fuzzyFilter } from '../files/fuzzy'

export function FileFinder({ onClose }: { onClose: () => void }) {
  const { files, loaded, loadFiles, openFile } = useFiles()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  useEffect(() => { if (!loaded) void loadFiles() }, [loaded, loadFiles])
  const results = useMemo(() => (q ? fuzzyFilter(q, files) : files.slice(0, 200).map((path) => ({ path, score: 0, positions: [] as number[] }))), [q, files])

  function pick(path: string) { void openFile(path); onClose() }
  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { setActive((a) => Math.min(a + 1, results.length - 1)); e.preventDefault() }
    else if (e.key === 'ArrowUp') { setActive((a) => Math.max(a - 1, 0)); e.preventDefault() }
    else if (e.key === 'Enter' && results[active]) pick(results[active].path)
    else if (e.key === 'Escape') onClose()
  }
  return (
    <div className="absolute inset-0 z-50 flex justify-center bg-black/50 pt-20" onClick={onClose}>
      <div className="h-fit max-h-[70vh] w-[560px] overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900" onClick={(e) => e.stopPropagation()}>
        <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setActive(0) }} onKeyDown={onKey} placeholder="buscar arquivo…" className="w-full bg-zinc-800 px-3 py-2 text-sm outline-none" />
        <div className="max-h-[60vh] overflow-auto">
          {results.map((r, i) => {
            const pos = new Set(r.positions)
            return (
              <div key={r.path} onClick={() => pick(r.path)} className={`cursor-pointer px-3 py-1 font-mono text-xs ${i === active ? 'bg-sky-900/50' : ''}`}>
                {r.path.split('').map((ch, j) => <span key={j} className={pos.has(j) ? 'text-sky-300' : 'text-zinc-300'}>{ch}</span>)}
              </div>
            )
          })}
          {results.length === 0 && <div className="px-3 py-2 text-xs text-zinc-600">nada encontrado</div>}
        </div>
      </div>
    </div>
  )
}
