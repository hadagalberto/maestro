import { create } from 'zustand'
import type { GitStatus } from '@shared/git'

interface GitStore {
  status: GitStatus | null
  selected: { file: string; staged: boolean } | null
  diff: string
  busy: boolean
  error: string | null
  refresh: () => Promise<void>
  select: (file: string, staged: boolean) => Promise<void>
  stage: (file: string) => Promise<void>
  unstage: (file: string) => Promise<void>
  commit: (message: string) => Promise<boolean>
  push: () => Promise<void>
  suggest: () => Promise<string>
}

export const useGit = create<GitStore>((set, get) => ({
  status: null, selected: null, diff: '', busy: false, error: null,
  refresh: async () => { set({ busy: true, error: null }); try { set({ status: await window.term.invoke('git:status', undefined) }) } finally { set({ busy: false }) } },
  select: async (file, staged) => { set({ selected: { file, staged } }); const diff = await window.term.invoke('git:diff', { file, staged }); set({ diff }) },
  stage: async (file) => { await window.term.invoke('git:stage', { file }); await get().refresh() },
  unstage: async (file) => { await window.term.invoke('git:unstage', { file }); await get().refresh() },
  commit: async (message) => { const r = await window.term.invoke('git:commit', { message }); if (!r.ok) { set({ error: r.message ?? 'commit falhou' }); return false } await get().refresh(); return true },
  push: async () => { const r = await window.term.invoke('git:push', undefined); if (!r.ok) set({ error: r.message ?? 'push falhou' }); else await get().refresh() },
  suggest: async () => { const r = await window.term.invoke('git:suggestCommit', undefined); return r.message },
}))
