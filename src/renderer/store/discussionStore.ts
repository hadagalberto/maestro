import { create } from 'zustand'
import type { Discussion, DiscussionEvent } from '@shared/discussion/types'

interface DiscussionStore {
  list: Discussion[]
  active: Discussion | null
  refresh: () => Promise<void>
  open: (id: string) => Promise<void>
  applyEvent: (ev: DiscussionEvent) => void
  closeActive: () => void
}

export const useDiscussions = create<DiscussionStore>((set, get) => ({
  list: [], active: null,
  refresh: async () => set({ list: await window.term.invoke('discussion:list', undefined) }),
  open: async (id) => { const d = await window.term.invoke('discussion:get', { id }); if (d) set({ active: d }) },
  closeActive: () => set({ active: null }),
  applyEvent: (ev) => {
    const a = get().active
    if (!a) return
    const next: Discussion = { ...a, transcript: [...a.transcript], cards: [...a.cards] }
    if (ev.type === 'turn-end' || ev.type === 'synthesis') next.transcript.push(ev.turn)
    else if (ev.type === 'card') next.cards.push(ev.card)
    else if (ev.type === 'status') next.status = ev.status
    set({ active: next })
  },
}))
