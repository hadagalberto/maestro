import { describe, it, expect, vi } from 'vitest'
import { isTrusted, isUnder } from './trust'

// realpath is mocked to identity (no FS) so tests are deterministic and cross-platform.
vi.mock('node:fs', () => ({ realpathSync: { native: (p: string) => p } }))

const T = (trusted: string[], denied: string[] = []) => ({ trustedFolders: trusted, deniedFolders: denied })

describe('isUnder', () => {
  it('mesma pasta conta', () => expect(isUnder('/a/b', '/a/b')).toBe(true))
  it('subpasta conta', () => expect(isUnder('/a/b/c', '/a/b')).toBe(true))
  it('prefixo de string que NÃO é subpasta não conta', () => expect(isUnder('/a/bc', '/a/b')).toBe(false))
  it('fora não conta', () => expect(isUnder('/x', '/a/b')).toBe(false))
})

describe('isTrusted', () => {
  it('herda do pai confiável', () => expect(isTrusted('/a/b/c', T(['/a']))).toBe(true))
  it('não confiável por padrão', () => expect(isTrusted('/a/b', T([]))).toBe(false))
  it('denied vence trusted', () => expect(isTrusted('/a/b', T(['/a'], ['/a/b']))).toBe(false))
  it('denied só afeta subárvore negada', () => expect(isTrusted('/a/c', T(['/a'], ['/a/b']))).toBe(true))
})
