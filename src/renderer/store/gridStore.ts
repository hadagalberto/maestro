import { create } from 'zustand'
import type { LayoutKind, PaneConfig } from '@shared/types'

interface GridState {
  activeLayout: LayoutKind
  panes: PaneConfig[]
  activePaneId: string | null
  setLayout: (l: LayoutKind) => void
  addPane: (p: PaneConfig) => void
  removePane: (id: string) => void
  setActive: (id: string) => void
}

export const useGrid = create<GridState>((set) => ({
  activeLayout: 'two',
  panes: [],
  activePaneId: null,
  setLayout: (activeLayout) => set({ activeLayout }),
  addPane: (p) => set((s) => ({ panes: [...s.panes, p], activePaneId: p.id })),
  removePane: (id) => set((s) => ({
    panes: s.panes.filter((x) => x.id !== id),
    activePaneId: s.activePaneId === id ? null : s.activePaneId,
  })),
  setActive: (activePaneId) => set({ activePaneId }),
}))
