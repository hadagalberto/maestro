import { useProject } from '../store/projectStore'
import type { Profile } from '@shared/ipc'

const sourceLabel: Record<Profile['source'], string> = { preset: 'preset', global: 'global', project: 'projeto' }

export function ProfilePicker({ onPick, onClose }: { onPick: (p: Profile) => void; onClose: () => void }) {
  const profiles = useProject((s) => s.profiles)
  const trusted = useProject((s) => s.trusted)
  return (
    <div className="absolute right-2 top-9 z-50 w-64 rounded border border-zinc-700 bg-zinc-900 p-1 shadow-xl" onMouseLeave={onClose}>
      {profiles.length === 0 && <div className="px-2 py-1 text-xs text-zinc-500">nenhum perfil</div>}
      {profiles.map((p) => {
        const locked = p.source === 'project' && !trusted
        return (
          <button key={p.id} onClick={() => onPick(p)}
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-zinc-800">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color ?? '#6e7681' }} />
            <span className="flex-1 truncate">{p.name}</span>
            {locked && <span className="text-[10px] text-amber-400">🔒</span>}
            <span className="text-[10px] text-zinc-500">{sourceLabel[p.source]}</span>
          </button>
        )
      })}
    </div>
  )
}
