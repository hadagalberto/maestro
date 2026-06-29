export function nextRestart(autoRestart: boolean | undefined, code: number, count: number, max = 3): { restart: boolean; delayMs: number } {
  if (!autoRestart || code === 0 || count >= max) return { restart: false, delayMs: 0 }
  return { restart: true, delayMs: 500 * 2 ** count }
}
