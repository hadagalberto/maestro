import { useEffect, useState } from 'react'
import { useGit } from '../store/gitStore'
import { GitDiffView } from './GitDiffView'
import type { GitFile } from '@shared/git'

const statusBadge: Record<string, string> = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', untracked: 'U', conflicted: '!' }

export function GitPanel({ onClose }: { onClose: () => void }) {
  const { status, diff, selected, error, refresh, select, stage, unstage, commit, push, suggest } = useGit()
  const [msg, setMsg] = useState('')
  const [busyMsg, setBusyMsg] = useState(false)
  useEffect(() => { void refresh() }, [refresh])

  const fileRow = (f: GitFile) => (
    <div key={(f.staged ? 's:' : 'u:') + f.path} onClick={() => void select(f.path, f.staged)}
      className={`flex items-center gap-2 rounded px-2 py-0.5 text-xs hover:bg-zinc-800 ${selected?.file === f.path && selected?.staged === f.staged ? 'bg-zinc-800' : ''}`}>
      <span className="w-3 text-zinc-500">{statusBadge[f.status] ?? '?'}</span>
      <span className="flex-1 truncate">{f.path}</span>
      <span className="text-green-500">+{f.added}</span><span className="text-red-500">-{f.deleted}</span>
      <button onClick={(e) => { e.stopPropagation(); void (f.staged ? unstage(f.path) : stage(f.path)) }} className="text-zinc-500 hover:text-zinc-200">{f.staged ? '−' : '+'}</button>
    </div>
  )

  async function askAI() { setBusyMsg(true); try { const m = await suggest(); if (m) setMsg(m) } finally { setBusyMsg(false) } }

  return (
    <div className="absolute inset-0 z-50 flex bg-black/40" onClick={onClose}>
      <div className="ml-auto flex h-full w-[520px] flex-col border-l border-zinc-700 bg-zinc-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2 text-sm">
          <span className="font-medium">Git</span>
          {status?.isRepo ? <span className="text-xs text-zinc-400">{status.branch ?? '(detached)'} {status.ahead ? `↑${status.ahead}` : ''} {status.behind ? `↓${status.behind}` : ''}</span> : <span className="text-xs text-zinc-500">não é um repositório git</span>}
          <button onClick={() => void refresh()} className="ml-auto text-xs text-zinc-400">refresh</button>
          <button onClick={onClose} className="text-xs text-zinc-400">fechar</button>
        </div>
        {error && <div className="border-b border-red-800/40 bg-red-950/30 px-3 py-1 text-xs text-red-200">{error}</div>}
        <div className="flex min-h-0 flex-1">
          <div className="w-56 shrink-0 overflow-auto border-r border-zinc-800 p-1">
            {status?.staged && status.staged.length > 0 && <><div className="px-2 py-1 text-[10px] uppercase text-zinc-500">Staged</div>{status.staged.map(fileRow)}</>}
            <div className="px-2 py-1 text-[10px] uppercase text-zinc-500">Mudanças</div>
            {status?.unstaged?.length ? status.unstaged.map(fileRow) : <div className="px-2 text-xs text-zinc-600">sem mudanças</div>}
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <GitDiffView diff={diff} />
            <div className="border-t border-zinc-800 p-2">
              <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={2} placeholder="mensagem de commit" className="mb-1 w-full rounded bg-zinc-800 p-1 text-xs" />
              <div className="flex gap-1">
                <button onClick={askAI} disabled={busyMsg} className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-sky-300">{busyMsg ? '…' : 'Ask AI'}</button>
                <button onClick={() => { void commit(msg).then((ok) => ok && setMsg('')) }} disabled={!msg.trim() || !status?.staged?.length} className="rounded bg-emerald-700 px-2 py-0.5 text-xs text-white disabled:opacity-40">Commit</button>
                <button onClick={() => void push()} className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-200">Push</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
