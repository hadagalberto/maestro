import { create } from 'zustand'
import type { Pin } from '@shared/pins'

interface PinsStore {
  pins: Pin[]
  notes: string
  refresh: () => Promise<void>
  addPin: (text: string) => Promise<void>
  toggle: (id: string, done: boolean) => Promise<void>
  edit: (id: string, text: string) => Promise<void>
  remove: (id: string) => Promise<void>
  setNotes: (notes: string) => void
}

let notesTimer: ReturnType<typeof setTimeout> | null = null

export const usePins = create<PinsStore>((set) => ({
  pins: [], notes: '',
  refresh: async () => { const [pins, notes] = await Promise.all([window.term.invoke('pins:list', undefined), window.term.invoke('notes:get', undefined)]); set({ pins, notes }) },
  addPin: async (text) => { if (!text.trim()) return; set({ pins: await window.term.invoke('pins:create', { text }) }) },
  toggle: async (id, done) => { set({ pins: await window.term.invoke('pins:setDone', { id, done }) }) },
  edit: async (id, text) => { set({ pins: await window.term.invoke('pins:update', { id, text }) }) },
  remove: async (id) => { set({ pins: await window.term.invoke('pins:delete', { id }) }) },
  setNotes: (notes) => { set({ notes }); if (notesTimer) clearTimeout(notesTimer); notesTimer = setTimeout(() => { void window.term.invoke('notes:set', { notes }) }, 600) },
}))
