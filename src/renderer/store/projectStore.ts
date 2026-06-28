import { create } from 'zustand'
import type { ProjectState } from '@shared/ipc'

interface ProjectStore extends ProjectState {
  hydrate: () => Promise<void>
  apply: (s: ProjectState) => void
}

const EMPTY: ProjectState = { currentProject: null, recentProjects: [], trusted: true, profiles: [], problems: [], hasMaestroFile: false }

export const useProject = create<ProjectStore>((set) => ({
  ...EMPTY,
  apply: (s) => set(s),
  hydrate: async () => {
    const s = await window.term.invoke('project:state', undefined)
    set(s)
  },
}))
