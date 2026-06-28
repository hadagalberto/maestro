import { useProject } from '../store/projectStore'

export function MaestroProblems() {
  const problems = useProject((s) => s.problems)
  const current = useProject((s) => s.currentProject)
  const hasFile = useProject((s) => s.hasMaestroFile)
  const apply = useProject((s) => s.apply)
  if (!current) return null

  async function scaffold() {
    const s = await window.term.invoke('maestro:scaffold', { path: current! })
    apply(s)
  }
  if (!hasFile) {
    return <div className="border-b border-zinc-800 px-3 py-1 text-xs text-zinc-400">Sem <code>maestro.yml</code> neste projeto. <button onClick={scaffold} className="text-sky-400 underline">criar</button></div>
  }
  if (problems.length === 0) return null
  return (
    <div className="border-b border-red-800/40 bg-red-950/30 px-3 py-1.5 text-xs text-red-200">
      <div className="font-semibold">maestro.yml inválido:</div>
      {problems.map((p, i) => (
        <div key={i} className="font-mono">
          {p.kind === 'syntax' ? `linha ${p.line}:${p.col} — ${p.message}` : `${p.path}: ${p.message}`}
        </div>
      ))}
    </div>
  )
}
