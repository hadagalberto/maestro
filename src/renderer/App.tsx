import { useEffect, useRef, useState } from 'react'
import { Sidebar } from './ui/Sidebar'
import { Toolbar } from './ui/Toolbar'
import { ProjectBar } from './ui/ProjectBar'
import { RestrictedBanner } from './ui/RestrictedBanner'
import { MaestroProblems } from './ui/MaestroProblems'
import { GlobalProfiles } from './ui/GlobalProfiles'
import { DiscussionsButton } from './ui/DiscussionsButton'
import { NewDiscussionModal } from './ui/NewDiscussionModal'
import { DiscussionList } from './ui/DiscussionList'
import { DiscussionView } from './ui/DiscussionView'
import { QueenPanel } from './ui/QueenPanel'
import { GitPanel } from './ui/GitPanel'
import { FileFinder } from './ui/FileFinder'
import { SearchPanel } from './ui/SearchPanel'
import { FileViewer } from './ui/FileViewer'
import { PinsPanel } from './ui/PinsPanel'
import { Grid } from './grid/Grid'
import { useGrid } from './store/gridStore'
import { useProject } from './store/projectStore'
import { useDiscussions } from './store/discussionStore'
import { usePins } from './store/pinsStore'
import { mountQueenBridge } from './queen/queenBridge'
import { yoloInject } from './cli/yolo'
import { loadQueenEnv, queenEnv } from './queen/queenInfo'
import { hydrateLayoutSizes } from './grid/layoutStorage'
import type { AppConfig, PaneConfig } from '@shared/types'
import type { Profile, ProjectState } from '@shared/ipc'

function uuid(): string { return crypto.randomUUID() }

export function App() {
  const panes = useGrid((s) => s.panes)
  const addPane = useGrid((s) => s.addPane)
  const setLayout = useGrid((s) => s.setLayout)
  const hydrated = useRef(false)
  const project = useProject()
  const autoStarted = useRef<Set<string>>(new Set())
  const prevProject = useRef<string | null>(null)
  const [switchPrompt, setSwitchPrompt] = useState<{ oldIds: string[] } | null>(null)
  const [showGlobals, setShowGlobals] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [showDiscussions, setShowDiscussions] = useState(false)
  const [showQueen, setShowQueen] = useState(false)
  const [showGit, setShowGit] = useState(false)
  const [showFinder, setShowFinder] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [showPins, setShowPins] = useState(false)
  const [taskNotify, setTaskNotify] = useState(true)
  const refreshDiscussions = useDiscussions((s) => s.refresh)

  useEffect(() => {
    void (async () => {
      await hydrateLayoutSizes()
      const cfg: AppConfig = await window.term.invoke('config:get', undefined)
      setLayout(cfg.activeLayout)
      setTaskNotify(cfg.settings.taskNotify ?? true)
      cfg.panes.forEach(addPane)
      await useProject.getState().hydrate()
      await loadQueenEnv()
      hydrated.current = true
    })()
    const offProject = window.term.on('project:changed', (s: ProjectState) => useProject.getState().apply(s))
    const offQueen = mountQueenBridge()
    const offPins = window.term.onPinsChanged(() => void usePins.getState().refresh())
    return () => { offProject(); offQueen(); offPins() }
  }, [addPane, setLayout])

  useEffect(() => {
    autoStarted.current = new Set()
    const prev = prevProject.current
    prevProject.current = project.currentProject
    // trocou de projeto com terminais abertos → pergunta o que fazer com os antigos
    // (snapshot ANTES do autoStart do novo projeto, que roda no effect declarado abaixo)
    if (prev && project.currentProject && prev !== project.currentProject) {
      const oldIds = useGrid.getState().panes.map((p) => p.id)
      if (oldIds.length) setSwitchPrompt({ oldIds })
    }
  }, [project.currentProject])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); setShowFinder(true) }
      else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); setShowSearch(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => { if (!hydrated.current) return; void window.term.invoke('config:set', { patch: { panes, activeLayout: useGrid.getState().activeLayout } }) }, [panes])

  function paneFromProfile(p: Profile, parentId?: string): PaneConfig {
    const id = uuid()
    const isProject = p.source === 'project'
    const yi = yoloInject(p.command, p.yolo)
    return { id, name: p.name, command: p.command, args: [...p.args, ...yi.args], cwd: p.cwd ?? project.currentProject ?? '.', env: { ...queenEnv(), MAESTRO_TERMINAL_ID: id, ...yi.env, ...(p.env ?? {}) }, color: p.color, profileId: p.id, origin: isProject ? 'project' : 'user', projectRoot: project.currentProject ?? undefined, parentId, autoRestart: p.autoRestart }
  }
  function pickProfile(p: Profile) { addPane(paneFromProfile(p)) }

  useEffect(() => {
    if (!project.trusted || !project.currentProject) return
    for (const p of project.profiles) {
      if (p.source === 'project' && p.autoStart && !autoStarted.current.has(p.id)) { autoStarted.current.add(p.id); addPane(paneFromProfile(p)) }
    }
  }, [project.trusted, project.currentProject, project.profiles])

  return (
    <div className="flex h-full w-full flex-col">
      <ProjectBar />
      <MaestroProblems />
      <RestrictedBanner />
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-1">
        <DiscussionsButton onClick={() => { setShowDiscussions((v) => !v); void refreshDiscussions() }} />
        <button onClick={() => setShowModal(true)} className="rounded bg-amber-700/70 px-2 py-0.5 text-xs text-white">+ discussão</button>
        <button onClick={() => setShowQueen(true)} className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-200">Queen</button>
        <button onClick={() => setShowGit(true)} className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-200">Git</button>
        <button onClick={() => setShowFinder(true)} className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-200">Arquivos</button>
        <button onClick={() => setShowSearch(true)} className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-200">Buscar</button>
        <button onClick={() => setShowPins(true)} className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-200">Pins</button>
        <button
          onClick={() => { const v = !taskNotify; setTaskNotify(v); void window.term.invoke('config:set', { patch: { settings: { taskNotify: v } } }) }}
          title="Notificar quando a IA concluir uma tarefa (só com a janela em background)"
          className="ml-auto rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-200"
        >{taskNotify ? '🔔' : '🔕'} Notif</button>
      </div>
      <Toolbar onPickProfile={pickProfile} />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1">{openId ? <DiscussionView id={openId} /> : <Grid />}</main>
        {showDiscussions && <DiscussionList onOpen={(id) => setOpenId(id)} />}
      </div>
      {openId && <button onClick={() => setOpenId(null)} className="absolute bottom-2 right-2 z-40 rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300">← terminais</button>}
      <button onClick={() => setShowGlobals(true)} className="absolute bottom-2 left-2 z-40 rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">perfis globais</button>
      {showGlobals && <GlobalProfiles onClose={() => setShowGlobals(false)} />}
      {showModal && <NewDiscussionModal onClose={() => setShowModal(false)} onStarted={(id) => { setShowModal(false); setShowDiscussions(true); setOpenId(id); void refreshDiscussions() }} />}
      {showQueen && <QueenPanel onClose={() => setShowQueen(false)} />}
      {showGit && <GitPanel onClose={() => setShowGit(false)} />}
      {showFinder && <FileFinder onClose={() => setShowFinder(false)} />}
      {showSearch && <SearchPanel onClose={() => setShowSearch(false)} />}
      {showPins && <PinsPanel onClose={() => setShowPins(false)} />}
      {switchPrompt && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-96 rounded border border-zinc-700 bg-zinc-900 p-4 text-sm">
            <div className="mb-2 font-semibold">Projeto alterado</div>
            <div className="mb-3 text-xs text-zinc-400">Fechar os {switchPrompt.oldIds.length} terminal(is) do projeto anterior? Eles continuam na pasta antiga.</div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setSwitchPrompt(null)} className="rounded bg-zinc-800 px-2 py-0.5 text-zinc-200">Manter</button>
              <button
                onClick={() => { const g = useGrid.getState(); for (const id of switchPrompt.oldIds) { void window.term.invoke('pty:kill', { id }); g.removePane(id) } setSwitchPrompt(null) }}
                className="rounded bg-red-700 px-2 py-0.5 text-white"
              >Fechar</button>
            </div>
          </div>
        </div>
      )}
      <FileViewer />
    </div>
  )
}
