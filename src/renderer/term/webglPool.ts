// Limita quantos addons WebGL vivem ao mesmo tempo (limite ~8-16 contextos/página).
const MAX_WEBGL = 8
const active = new Set<string>()

export function canEnableWebgl(id: string): boolean {
  if (active.has(id)) return true
  if (active.size >= MAX_WEBGL) return false
  active.add(id)
  return true
}
export function releaseWebgl(id: string): void { active.delete(id) }
