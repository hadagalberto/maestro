import { describe, it, expect } from 'vitest'
import { QueenAuth } from './auth'

describe('QueenAuth', () => {
  const a = new QueenAuth('secrettoken')
  it('aceita Bearer correto', () => expect(a.checkToken('Bearer secrettoken')).toBe(true))
  it('rejeita token errado', () => expect(a.checkToken('Bearer nope')).toBe(false))
  it('rejeita ausente/sem Bearer', () => { expect(a.checkToken(undefined)).toBe(false); expect(a.checkToken('secrettoken')).toBe(false) })
  it('rejeita tamanho diferente sem lançar', () => expect(a.checkToken('Bearer x')).toBe(false))
  it('host loopback ok, outro nega', () => {
    expect(a.hostAllowed('127.0.0.1:55001', 55001)).toBe(true)
    expect(a.hostAllowed('localhost:55001', 55001)).toBe(true)
    expect(a.hostAllowed('evil.com:55001', 55001)).toBe(false)
    expect(a.hostAllowed(undefined, 55001)).toBe(false)
  })
  it('origin ausente ok (não-browser); browser nega', () => {
    expect(a.originAllowed(undefined)).toBe(true)
    expect(a.originAllowed('http://127.0.0.1:55001')).toBe(true)
    expect(a.originAllowed('https://evil.com')).toBe(false)
  })
})
