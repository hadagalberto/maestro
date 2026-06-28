import { useState } from 'react'
import { useProject } from '../store/projectStore'
import type { ProfileEntry } from '@shared/ipc'

export function GlobalProfiles({ onClose }: { onClose: () => void }) {
  const apply = useProject((s) => s.apply)
  const globals = useProject((s) => s.profiles.filter((p) => p.source === 'global'))
  const [id, setId] = useState(''); const [command, setCommand] = useState('')

  async function save() {
    if (!id.trim() || !command.trim()) return
    const cur: Record<string, ProfileEntry> = {}
    for (const g of globals) cur[g.id] = { command: g.command, args: g.args, color: g.color }
    cur[id.trim()] = { command: command.trim(), args: [] }
    const s = await window.term.invoke('profiles:setGlobal', { profiles: cur })
    apply(s); setId(''); setCommand('')
  }
  async function remove(rid: string) {
    const cur: Record<string, ProfileEntry> = {}
    for (const g of globals) if (g.id !== rid) cur[g.id] = { command: g.command, args: g.args, color: g.color }
    const s = await window.term.invoke('profiles:setGlobal', { profiles: cur })
    apply(s)
  }
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-96 rounded border border-zinc-700 bg-zinc-900 p-4 text-sm" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 font-semibold">Perfis globais</div>
        {globals.length === 0 && <div className="mb-2 text-xs text-zinc-500">nenhum perfil global</div>}
        {globals.map((g) => (
          <div key={g.id} className="flex items-center gap-2 py-0.5">
            <span className="flex-1">{g.name} <span className="text-zinc-500">({g.command})</span></span>
            <button onClick={() => remove(g.id)} className="text-zinc-500 hover:text-red-400">remover</button>
          </div>
        ))}
        <div className="mt-2 flex gap-1">
          <input value={id} onChange={(e) => setId(e.target.value)} placeholder="id" className="w-24 rounded bg-zinc-800 px-1 py-0.5" />
          <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="command" className="flex-1 rounded bg-zinc-800 px-1 py-0.5" />
          <button onClick={save} className="rounded bg-sky-600 px-2 text-white">add</button>
        </div>
        <button onClick={onClose} className="mt-3 text-xs text-zinc-400">fechar</button>
      </div>
    </div>
  )
}
