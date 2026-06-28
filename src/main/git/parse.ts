import type { FileStatus } from '@shared/git'

export interface BranchInfo { branch: string | null; ahead: number; behind: number }
export interface PorcelainEntry { path: string; x: string; y: string; status: FileStatus; staged: boolean; unstaged: boolean }

export function parseBranchLine(line: string): BranchInfo {
  const body = line.replace(/^## /, '')
  if (body.startsWith('No commits yet on ')) return { branch: body.slice('No commits yet on '.length).trim() || null, ahead: 0, behind: 0 }
  if (body.startsWith('HEAD (no branch)')) return { branch: null, ahead: 0, behind: 0 }
  const branch = body.split('...')[0].split(' ')[0] || null
  const ahead = /ahead (\d+)/.exec(body)?.[1]
  const behind = /behind (\d+)/.exec(body)?.[1]
  return { branch, ahead: ahead ? Number(ahead) : 0, behind: behind ? Number(behind) : 0 }
}

export function parseNumstat(s: string): Record<string, { added: number; deleted: number }> {
  const out: Record<string, { added: number; deleted: number }> = {}
  for (const line of s.split('\n')) {
    if (!line.trim()) continue
    const [a, d, ...rest] = line.split('\t')
    const path = rest.join('\t')
    if (!path) continue
    out[path] = { added: a === '-' ? 0 : Number(a), deleted: d === '-' ? 0 : Number(d) }
  }
  return out
}

function codeToStatus(x: string, y: string): FileStatus {
  if (x === '?' && y === '?') return 'untracked'
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) return 'conflicted'
  const c = x !== ' ' && x !== '?' ? x : y
  if (c === 'A') return 'added'
  if (c === 'D') return 'deleted'
  if (c === 'R') return 'renamed'
  return 'modified'
}

export function parsePorcelain(z: string): { branch: BranchInfo; files: PorcelainEntry[] } {
  const tokens = z.split('\0')
  let branch: BranchInfo = { branch: null, ahead: 0, behind: 0 }
  const files: PorcelainEntry[] = []
  let i = 0
  if (tokens[0]?.startsWith('## ')) { branch = parseBranchLine(tokens[0]); i = 1 }
  for (; i < tokens.length; i++) {
    const t = tokens[i]
    if (!t) continue
    const x = t[0]; const y = t[1]; const path = t.slice(3)
    if (x === 'R' || x === 'C') i++ // rename/copy: next token is the original path — consume it
    // unstaged = Y not space OR untracked (?? has x === '?'); the latter is implied by y !== ' ' but kept explicit for clarity
    files.push({ path, x, y, status: codeToStatus(x, y), staged: x !== ' ' && x !== '?', unstaged: y !== ' ' || x === '?' })
  }
  return { branch, files }
}
