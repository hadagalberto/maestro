import path from 'node:path'
import fs from 'node:fs'
import type { TrustConfig } from '@shared/types'

// Canonicalize: resolve symlinks/junctions/8.3/\\?\ when the path exists, else lexical resolve.
// Case-fold on win32 so trust comparison is case-insensitive there.
export function canonical(p: string): string {
  let resolved: string
  try { resolved = fs.realpathSync.native(path.resolve(p)) }
  catch { resolved = path.resolve(p) }
  resolved = resolved.replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

// Containment by path segments (NOT string prefix): '/a/bc' is NOT under '/a/b'.
export function isUnder(child: string, root: string): boolean {
  const c = canonical(child)
  const r = canonical(root)
  if (c === r) return true
  const rel = path.relative(r, c)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

export function isTrusted(target: string, trust: TrustConfig): boolean {
  if (trust.deniedFolders.some((d) => isUnder(target, d))) return false
  return trust.trustedFolders.some((t) => isUnder(target, t))
}
