import { create } from 'zustand'
import type { LayoutKind, PaneConfig } from '@shared/types'

interface GridState {
  activeLayout: LayoutKind
  panes: PaneConfig[]
  activePaneId: string | null
  exited: Record<string, number>
  setLayout: (l: LayoutKind) => void
  addPane: (p: PaneConfig) => void
  removePane: (id: string) => void
  removePaneTree: (id: string) => string[]
  setActive: (id: string) => void
  setExited: (id: string, code: number) => void
  clearExited: (id: string) => void
}

export const useGrid = create<GridState>((set, get) => ({
  activeLayout: 'two',
  panes: [],
  activePaneId: null,
  exited: {},
  setLayout: (activeLayout) => set({ activeLayout }),
  addPane: (p) => set((s) => ({ panes: [...s.panes, p], activePaneId: p.id })),
  removePane: (id) => set((s) => ({
    panes: s.panes.filter((x) => x.id !== id),
    activePaneId: s.activePaneId === id ? null : s.activePaneId,
  })),
  removePaneTree: (id) => {
    const s = get()
    const ids = new Set<string>()
    const visit = (pid: string) => { if (ids.has(pid)) return; ids.add(pid); for (const c of s.panes) if (c.parentId === pid) visit(c.id) }
    visit(id)
    set({ panes: s.panes.filter((p) => !ids.has(p.id)), activePaneId: ids.has(s.activePaneId ?? '') ? null : s.activePaneId })
    return [...ids]
  },
  setActive: (activePaneId) => set({ activePaneId }),
  setExited: (id, code) => set((s) => ({ exited: { ...s.exited, [id]: code } })),
  clearExited: (id) => set((s) => { const e = { ...s.exited }; delete e[id]; return { exited: e } }),
}))
