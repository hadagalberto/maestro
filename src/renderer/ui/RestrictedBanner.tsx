import { useProject } from '../store/projectStore'

export function RestrictedBanner() {
  const current = useProject((s) => s.currentProject)
  const trusted = useProject((s) => s.trusted)
  const profiles = useProject((s) => s.profiles)
  const apply = useProject((s) => s.apply)
  const hasProject = profiles.some((p) => p.source === 'project')
  if (!current || trusted || !hasProject) return null

  async function grant(parent: boolean) {
    const ch = parent ? 'trust:grantParent' : 'trust:grant'
    const s = await window.term.invoke(ch, { path: current! })
    apply(s)
  }
  return (
    <div className="flex items-center gap-2 border-b border-amber-700/40 bg-amber-950/40 px-3 py-1.5 text-xs text-amber-200">
      <span className="flex-1">Modo Restrito — este projeto define perfis que executam programas. Confie na pasta para habilitá-los.</span>
      <button onClick={() => grant(false)} className="rounded bg-amber-600 px-2 py-0.5 text-white">Confiar</button>
      <button onClick={() => grant(true)} className="rounded bg-amber-800/60 px-2 py-0.5">Confiar na pasta-pai</button>
    </div>
  )
}
