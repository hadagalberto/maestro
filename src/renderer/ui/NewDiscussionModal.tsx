import { useState } from 'react'
import { useProject } from '../store/projectStore'
import type { TemplateKind } from '@shared/discussion/types'

const TEMPLATES: { kind: TemplateKind; name: string; desc: string }[] = [
  { kind: 'decision', name: 'Decision', desc: 'Dois lados argumentam; termina em decisão.' },
  { kind: 'brainstorm', name: 'Brainstorm', desc: 'Perspectivas variadas; termina em síntese.' },
  { kind: 'review', name: 'Review', desc: 'Defensor vs atacante sobre código/abordagem.' },
  { kind: 'plan', name: 'Plan', desc: 'Lentes de produto e engenharia montam um plano.' },
  { kind: 'dev-squad', name: 'Dev squad', desc: 'Divide a feature entre os agentes em paralelo.' },
  { kind: 'custom', name: 'Custom', desc: 'Todos respondem; orquestrador sintetiza.' },
]

export function NewDiscussionModal({ onClose, onStarted }: { onClose: () => void; onStarted: (id: string) => void }) {
  const profiles = useProject((s) => s.profiles)
  const [kind, setKind] = useState<TemplateKind>('decision')
  const [topic, setTopic] = useState('')
  const [orchestrator, setOrchestrator] = useState(profiles[0]?.id ?? '')
  const [parts, setParts] = useState<string[]>([])
  const [autonomous, setAutonomous] = useState(true)
  const [err, setErr] = useState('')

  function toggle(id: string) { setParts((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])) }
  async function start() {
    if (parts.length < 2) { setErr('Escolha ao menos 2 participantes'); return }
    if (!orchestrator) { setErr('Escolha um orquestrador'); return }
    try {
      const { id } = await window.term.invoke('discussion:start', { topic: topic || '(sem tópico)', templateKind: kind, orchestratorProfileId: orchestrator, participantProfileIds: parts, autonomous })
      onStarted(id)
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      setErr(m.includes('TRUST_REQUIRED') ? 'Confie no projeto antes de iniciar.' : m)
    }
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-[640px] max-h-[90vh] overflow-auto rounded-lg border border-zinc-700 bg-zinc-900 p-5 text-sm" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 text-base font-semibold">Nova discussão</div>
        <div className="mb-1 text-xs text-zinc-400">Template</div>
        <div className="mb-4 grid grid-cols-2 gap-2">
          {TEMPLATES.map((t) => (
            <button key={t.kind} onClick={() => setKind(t.kind)}
              className={`rounded border p-2 text-left ${kind === t.kind ? 'border-amber-500 bg-amber-950/30' : 'border-zinc-700 bg-zinc-800/40'}`}>
              <div className="font-medium">{t.name}</div>
              <div className="text-[11px] text-zinc-400">{t.desc}</div>
            </button>
          ))}
        </div>
        <div className="mb-1 text-xs text-zinc-400">Tópico</div>
        <textarea value={topic} onChange={(e) => setTopic(e.target.value)} rows={2} className="mb-4 w-full rounded bg-zinc-800 p-2" placeholder="ex: Stripe ou Paddle para billing?" />
        <div className="mb-1 text-xs text-zinc-400">Orquestrador</div>
        <select value={orchestrator} onChange={(e) => setOrchestrator(e.target.value)} className="mb-4 w-full rounded bg-zinc-800 p-2">
          {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div className="mb-1 text-xs text-zinc-400">Participantes (≥2)</div>
        <div className="mb-4 flex flex-wrap gap-2">
          {profiles.map((p) => (
            <button key={p.id} onClick={() => toggle(p.id)}
              className={`flex items-center gap-1 rounded border px-2 py-1 ${parts.includes(p.id) ? 'border-sky-500 bg-sky-950/40' : 'border-zinc-700'}`}>
              <span className="h-2 w-2 rounded-full" style={{ background: p.color ?? '#6e7681' }} />{p.name}
            </button>
          ))}
        </div>
        <label className="mb-4 flex items-center gap-2 text-xs"><input type="checkbox" checked={autonomous} onChange={(e) => setAutonomous(e.target.checked)} /> Modo autônomo</label>
        {err && <div className="mb-2 text-xs text-red-400">{err}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded px-3 py-1 text-zinc-400">Cancelar</button>
          <button onClick={start} className="rounded bg-amber-600 px-3 py-1 text-white">Start discussion</button>
        </div>
      </div>
    </div>
  )
}
