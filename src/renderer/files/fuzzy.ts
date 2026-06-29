export interface FuzzyResult { path: string; score: number; positions: number[] }

const isBoundary = (s: string, i: number): boolean => {
  if (i === 0) return true
  const p = s[i - 1]
  return p === '/' || p === '_' || p === '-' || p === '.' || (p === p.toLowerCase() && s[i] === s[i].toUpperCase())
}

export function fuzzyScore(query: string, target: string): { score: number; positions: number[] } | null {
  if (!query) return { score: 0, positions: [] }
  const q = query.toLowerCase(); const t = target.toLowerCase()
  const baseStart = target.lastIndexOf('/') + 1
  const positions: number[] = []
  let qi = 0; let score = 0; let prev = -2
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      positions.push(i)
      let pt = 1
      if (i === prev + 1) pt += 10           // consecutive (must dominate a single boundary bonus)
      if (isBoundary(target, i)) pt += 8      // word/segment boundary
      if (i >= baseStart) pt += 6             // in basename
      score += pt; prev = i; qi++
    }
  }
  if (qi < q.length) return null
  score -= (target.length - q.length) * 0.1   // slight preference for shorter targets
  return { score, positions }
}

export function fuzzyFilter(query: string, paths: string[], limit = 200): FuzzyResult[] {
  const out: FuzzyResult[] = []
  for (const path of paths) { const r = fuzzyScore(query, path); if (r) out.push({ path, ...r }) }
  out.sort((a, b) => b.score - a.score)
  return out.slice(0, limit)
}
