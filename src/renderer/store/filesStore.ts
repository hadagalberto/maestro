import { create } from 'zustand'
import type { FileContent, SearchFileResult, SearchOptions } from '@shared/files'

interface FilesStore {
  files: string[]
  loaded: boolean
  viewer: FileContent | null
  results: SearchFileResult[]
  searching: boolean
  loadFiles: () => Promise<void>
  openFile: (path: string) => Promise<void>
  closeViewer: () => void
  search: (query: string, opts: SearchOptions) => Promise<void>
}

export const useFiles = create<FilesStore>((set) => ({
  files: [], loaded: false, viewer: null, results: [], searching: false,
  loadFiles: async () => { const files = await window.term.invoke('files:list', undefined); set({ files, loaded: true }) },
  openFile: async (path) => { const viewer = await window.term.invoke('files:read', { path }); set({ viewer }) },
  closeViewer: () => set({ viewer: null }),
  search: async (query, opts) => { set({ searching: true }); try { set({ results: await window.term.invoke('files:search', { query, opts }) }) } finally { set({ searching: false }) } },
}))
