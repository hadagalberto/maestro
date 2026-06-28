// id -> function returning the terminal's current serialized text (set by TerminalPane on mount)
const readers = new Map<string, () => string>()
export function registerTerminalReader(id: string, read: () => string): void { readers.set(id, read) }
export function unregisterTerminalReader(id: string): void { readers.delete(id) }
export function readTerminal(id: string, maxChars = 4000): string {
  const r = readers.get(id)
  if (!r) return ''
  const text = r()
  return text.length > maxChars ? text.slice(-maxChars) : text
}
