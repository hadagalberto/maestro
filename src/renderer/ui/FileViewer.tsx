import { useEffect, useState } from 'react'
import { useFiles } from '../store/filesStore'
import { highlight } from '../files/highlighter'

export function FileViewer() {
  const viewer = useFiles((s) => s.viewer)
  const close = useFiles((s) => s.closeViewer)
  const [html, setHtml] = useState('')
  useEffect(() => {
    setHtml('')
    if (!viewer || viewer.binary) return
    let alive = true
    void highlight(viewer.content, viewer.path).then((h) => { if (alive) setHtml(h) }).catch(() => {})
    return () => { alive = false }
  }, [viewer])
  if (!viewer) return null
  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-zinc-950" onClick={close}>
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2 text-sm" onClick={(e) => e.stopPropagation()}>
        <span className="font-mono text-xs">{viewer.path}</span>
        {viewer.truncated && <span className="text-[10px] text-amber-400">(truncado)</span>}
        <button onClick={close} className="ml-auto text-xs text-zinc-400">fechar</button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2 text-xs" onClick={(e) => e.stopPropagation()}>
        {viewer.binary ? <div className="text-zinc-500">(arquivo binário)</div>
          : html ? <div className="shiki-host" dangerouslySetInnerHTML={{ __html: html }} />
          : <pre className="whitespace-pre font-mono text-zinc-300">{viewer.content}</pre>}
      </div>
    </div>
  )
}
