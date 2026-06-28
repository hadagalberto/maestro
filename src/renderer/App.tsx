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
import { Grid } from './grid/Grid'
import { useGrid } from './store/gridStore'
import { useProject } from './store/projectStore'
import { useDiscussions } from './store/discussionStore'
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
  const [showGlobals, setShowGlobals] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [showDiscussions, setShowDiscussions] = useState(false)
  const refreshDiscussions = useDiscussions((s) => s.refresh)

  useEffect(() => {
    void (async () => {
      await hydrateLayoutSizes()
      const cfg: AppConfig = await window.term.invoke('config:get', undefined)
      setLayout(cfg.activeLayout)
      cfg.panes.forEach(addPane)
      await useProject.getState().hydrate()
      hydrated.current = true
    })()
    const off = window.term.on('project:changed', (s: ProjectState) => useProject.getState().apply(s))
    return off
  }, [addPane, setLayout])

  useEffect(() => { autoStarted.current = new Set() }, [project.currentProject])
  useEffect(() => { if (!hydrated.current) return; void window.term.invoke('config:set', { patch: { panes, activeLayout: useGrid.getState().activeLayout } }) }, [panes])

  function paneFromProfile(p: Profile): PaneConfig {
    const isProject = p.source === 'project'
    return { id: uuid(), name: p.name, command: p.command, args: p.args, cwd: p.cwd ?? project.currentProject ?? '.', env: p.env, color: p.color, profileId: p.id, origin: isProject ? 'project' : 'user', projectRoot: project.currentProject ?? undefined }
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
    </div>
  )
}
