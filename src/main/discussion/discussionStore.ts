import ElectronStore from 'electron-store'
import type { Discussion } from '@shared/discussion/types'

const Store = (ElectronStore as unknown as { default?: typeof ElectronStore }).default ?? ElectronStore

export class DiscussionStore {
  private store = new Store<{ discussions: Discussion[] }>({ name: 'maestro-discussions' })
  list(): Discussion[] { return this.store.get('discussions') ?? [] }
  get(id: string): Discussion | null { return this.list().find((d) => d.id === id) ?? null }
  upsert(d: Discussion): void {
    const all = this.list().filter((x) => x.id !== d.id)
    this.store.set('discussions', [d, ...all].slice(0, 50))
  }
  delete(id: string): void { this.store.set('discussions', this.list().filter((d) => d.id !== id)) }
}
