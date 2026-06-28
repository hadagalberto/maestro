import { useGrid } from '../store/gridStore'
import { useProject } from '../store/projectStore'
import { readTerminal } from './terminalRegistry'
import { queenEnv } from './queenInfo'
import type { PaneConfig, Profile } from '@shared/types'
import type { QueenRequest } from '@shared/queen'

function uuid(): string { return crypto.randomUUID() }

function paneFromProfile(p: Profile, projectRoot: string | null): PaneConfig {
  const isProject = p.source === 'project'
  return { id: uuid(), name: p.name, command: p.command, args: p.args, cwd: p.cwd ?? projectRoot ?? '.', env: { ...queenEnv(), ...(p.env ?? {}) }, color: p.color, profileId: p.id, origin: isProject ? 'project' : 'user', projectRoot: projectRoot ?? undefined }
}

async function handle(req: QueenRequest): Promise<unknown> {
  const grid = useGrid.getState()
  const proj = useProject.getState()
  switch (req.op) {
    case 'terminals.list':
      return grid.panes.map((p) => ({ id: p.id, name: p.name, command: p.command }))
    case 'terminals.spawn': {
      const a = req.args as { profileId?: string; command?: string; name?: string }
      let pane: PaneConfig
      if (a.profileId) {
        const prof = proj.profiles.find((p) => p.id === a.profileId)
        if (!prof) throw new Error(`profile ${a.profileId} not found`)
        pane = paneFromProfile(prof, proj.currentProject)
      } else if (a.command) {
        pane = { id: uuid(), name: a.name ?? a.command, command: a.command, cwd: proj.currentProject ?? '.', env: queenEnv(), origin: 'user', projectRoot: proj.currentProject ?? undefined }
      } else throw new Error('profileId or command required')
      grid.addPane(pane)
      return { id: pane.id }
    }
    case 'terminals.kill': {
      const id = (req.args as { id: string }).id
      grid.removePane(id); void window.term.invoke('pty:kill', { id })
      return { ok: true }
    }
    case 'terminals.read': {
      const a = req.args as { id: string; maxChars?: number }
      return readTerminal(a.id, a.maxChars)
    }
    case 'terminals.write': {
      const a = req.args as { id: string; data: string }
      await window.term.invoke('pty:write', { id: a.id, data: a.data })
      return { ok: true }
    }
    default: throw new Error(`unknown op ${req.op}`)
  }
}

export function mountQueenBridge(): () => void {
  return window.term.onQueenRequest((req) => {
    handle(req).then(
      (result) => window.term.queenRespond({ reqId: req.reqId, ok: true, result }),
      (e: unknown) => window.term.queenRespond({ reqId: req.reqId, ok: false, error: e instanceof Error ? e.message : String(e) }),
    )
  })
}
