import { useEffect, useRef } from 'react'
import { Sidebar } from './ui/Sidebar'
import { Toolbar } from './ui/Toolbar'
import { Grid } from './grid/Grid'
import { useGrid } from './store/gridStore'
import { hydrateLayoutSizes } from './grid/layoutStorage'
import type { AppConfig, PaneConfig } from '@shared/types'

function uuid(): string { return crypto.randomUUID() }
const defaultCommand = navigator.platform.startsWith('Win') ? 'powershell.exe' : 'bash'

export function App() {
  const panes = useGrid((s) => s.panes)
  const addPane = useGrid((s) => s.addPane)
  const setLayout = useGrid((s) => s.setLayout)
  const hydrated = useRef(false)

  useEffect(() => {
    void (async () => {
      await hydrateLayoutSizes()
      const cfg: AppConfig = await window.term.invoke('config:get', undefined)
      setLayout(cfg.activeLayout)
      cfg.panes.forEach(addPane)
      hydrated.current = true
    })()
  }, [addPane, setLayout])

  useEffect(() => {
    if (!hydrated.current) return
    void window.term.invoke('config:set', { patch: { panes, activeLayout: useGrid.getState().activeLayout } })
  }, [panes])

  function newTerminal() {
    const p: PaneConfig = { id: uuid(), name: defaultCommand, command: defaultCommand, cwd: '.' }
    addPane(p)
  }

  return (
    <div className="flex h-full w-full flex-col">
      <Toolbar onNewTerminal={newTerminal} />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1"><Grid /></main>
      </div>
    </div>
  )
}
