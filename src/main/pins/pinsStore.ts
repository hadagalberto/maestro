import ElectronStore from 'electron-store'
import { randomUUID } from 'node:crypto'
import type { Pin, PinsData } from '@shared/pins'

const Store = (ElectronStore as unknown as { default?: typeof ElectronStore }).default ?? ElectronStore
const EMPTY: PinsData = { pins: [], notes: '' }
const CAP = 500

export class PinsStore {
  private store = new Store<{ byProject: Record<string, PinsData> }>({ name: 'maestro-pins' })
  private all(): Record<string, PinsData> { return this.store.get('byProject') ?? {} }
  private save(root: string, d: PinsData): void { const all = this.all(); all[root] = d; this.store.set('byProject', all) }

  get(root: string): PinsData { return this.all()[root] ?? EMPTY }
  listPins(root: string): Pin[] { return this.get(root).pins }
  createPin(root: string, text: string, terminalId?: string): Pin {
    const d = this.get(root)
    const pin: Pin = { id: randomUUID(), text, done: false, terminalId, createdAt: Date.now() }
    this.save(root, { ...d, pins: [...d.pins, pin].slice(-CAP) })
    return pin
  }
  updatePin(root: string, id: string, text: string): void { const d = this.get(root); this.save(root, { ...d, pins: d.pins.map((p) => (p.id === id ? { ...p, text } : p)) }) }
  setPinDone(root: string, id: string, done: boolean): void { const d = this.get(root); this.save(root, { ...d, pins: d.pins.map((p) => (p.id === id ? { ...p, done } : p)) }) }
  deletePin(root: string, id: string): void { const d = this.get(root); this.save(root, { ...d, pins: d.pins.filter((p) => p.id !== id) }) }
  getNotes(root: string): string { return this.get(root).notes }
  setNotes(root: string, notes: string): void { this.save(root, { ...this.get(root), notes }) }
  appendNotes(root: string, chunk: string): void { const cur = this.getNotes(root); this.setNotes(root, cur ? `${cur}\n${chunk}` : chunk) }
}
