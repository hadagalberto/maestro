import { describe, it, expect } from 'vitest'
import { nextRestart } from './restart'

describe('nextRestart', () => {
  it('autoRestart off -> não', () => expect(nextRestart(false, 1, 0).restart).toBe(false))
  it('exit 0 -> não', () => expect(nextRestart(true, 0, 0).restart).toBe(false))
  it('code!=0 e count<max -> sim com backoff crescente', () => {
    expect(nextRestart(true, 1, 0)).toEqual({ restart: true, delayMs: 500 })
    expect(nextRestart(true, 1, 1)).toEqual({ restart: true, delayMs: 1000 })
    expect(nextRestart(true, 1, 2)).toEqual({ restart: true, delayMs: 2000 })
  })
  it('count>=max -> não', () => expect(nextRestart(true, 1, 3).restart).toBe(false))
})
