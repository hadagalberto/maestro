import { useEffect, useState } from 'react'
import type { QueenInfo } from '@shared/ipc'

export function QueenPanel({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<QueenInfo | null>(null)
  useEffect(() => { void window.term.invoke('queen:info', undefined).then(setInfo) }, [])
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-[560px] rounded-lg border border-zinc-700 bg-zinc-900 p-5 text-sm" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 text-base font-semibold">Queen — servidor MCP</div>
        {!info?.running && <div className="text-zinc-400">servidor não está rodando</div>}
        {info?.running && (
          <>
            <div className="mb-1 text-xs text-zinc-400">Status</div>
            <div className="mb-3 text-emerald-400">rodando na porta {info.port}</div>
            <div className="mb-1 text-xs text-zinc-400">URL</div>
            <code className="mb-3 block break-all rounded bg-zinc-800 p-2">{info.url}</code>
            <div className="mb-1 text-xs text-zinc-400">Token</div>
            <code className="mb-3 block break-all rounded bg-zinc-800 p-2">{info.token}</code>
            <div className="mb-1 text-xs text-zinc-400">Conectar (Claude Code)</div>
            <code className="block break-all rounded bg-zinc-800 p-2 text-xs">claude mcp add --transport http maestro {info.url} --header "Authorization: Bearer {info.token}"</code>
            <div className="mt-2 text-[11px] text-zinc-500">Gemini usa <code>httpUrl</code> em vez de <code>url</code> no settings. Token e URL também ficam em <code>queen.json</code> (userData).</div>
          </>
        )}
        <div className="mt-4 flex justify-end"><button onClick={onClose} className="rounded px-3 py-1 text-zinc-400">fechar</button></div>
      </div>
    </div>
  )
}
