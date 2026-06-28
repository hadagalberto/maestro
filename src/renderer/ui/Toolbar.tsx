import { useState } from 'react'
import { useGrid } from '../store/gridStore'
import { ProfilePicker } from './ProfilePicker'
import type { LayoutKind } from '@shared/types'
import type { Profile } from '@shared/ipc'

const layouts: { key: LayoutKind; label: string }[] = [
  { key: 'two', label: '2' }, { key: 'three', label: '3' }, { key: 'quad', label: '2x2' },
]

export function Toolbar({ onPickProfile }: { onPickProfile: (p: Profile) => void }) {
  const active = useGrid((s) => s.activeLayout)
  const setLayout = useGrid((s) => s.setLayout)
  const [open, setOpen] = useState(false)
  return (
    <div className="relative flex items-center gap-2 border-b border-zinc-800 px-3 py-1.5">
      <span className="text-xs text-zinc-400">Layout</span>
      {layouts.map((l) => (
        <button key={l.key} onClick={() => setLayout(l.key)}
          className={`rounded px-2 py-0.5 text-xs ${active === l.key ? 'bg-sky-600 text-white' : 'bg-zinc-800 text-zinc-300'}`}>{l.label}</button>
      ))}
      <button onClick={() => setOpen((v) => !v)} className="ml-auto rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-200">+ terminal</button>
      {open && <ProfilePicker onPick={(p) => { setOpen(false); onPickProfile(p) }} onClose={() => setOpen(false)} />}
    </div>
  )
}
