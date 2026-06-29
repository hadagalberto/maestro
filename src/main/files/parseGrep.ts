import type { SearchFileResult } from '@shared/files'

// Parses `git grep -n` output (no -z): each line `path:line:text` (text may contain ':').
export function parseGrep(out: string, maxPerFile = 200): SearchFileResult[] {
  const byPath = new Map<string, SearchFileResult>()
  for (const raw0 of out.split('\n')) {
    const raw = raw0.endsWith('\r') ? raw0.slice(0, -1) : raw0
    if (!raw) continue
    const m = /^(.*?):(\d+):(.*)$/.exec(raw)
    if (!m) continue
    const path = m[1]; const line = Number(m[2]); const text = m[3]
    let entry = byPath.get(path)
    if (!entry) { entry = { path, matches: [] }; byPath.set(path, entry) }
    if (entry.matches.length < maxPerFile) entry.matches.push({ line, text })
  }
  return [...byPath.values()]
}
