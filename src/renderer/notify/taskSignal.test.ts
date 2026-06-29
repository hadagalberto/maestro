import { describe, it, expect } from 'vitest'
import { initialArm, armOnInput, noteOutput, onIdle } from './taskSignal'

describe('taskSignal (detecção de tarefa por inatividade)', () => {
  it('idle sem arme não dispara', () => {
    expect(onIdle(initialArm())).toEqual({ fire: false, next: initialArm() })
  })

  it('arme sem output não dispara', () => {
    expect(onIdle(armOnInput())).toEqual({ fire: false, next: armOnInput() })
  })

  it('arme + output + idle dispara e reseta', () => {
    const s = noteOutput(armOnInput())
    const r = onIdle(s)
    expect(r.fire).toBe(true)
    expect(r.next).toEqual(initialArm())
  })

  it('após disparar, novo idle não redispara (desarmado)', () => {
    const r1 = onIdle(noteOutput(armOnInput()))
    const r2 = onIdle(r1.next)
    expect(r2.fire).toBe(false)
  })

  it('output sem arme é ignorado', () => {
    expect(noteOutput(initialArm())).toEqual(initialArm())
  })

  it('re-arme após output volta a exigir novo output', () => {
    const armedWithOutput = noteOutput(armOnInput())
    const reArmed = armOnInput() // usuário mandou outra coisa
    expect(reArmed.sawOutput).toBe(false)
    expect(onIdle(reArmed).fire).toBe(false)
    void armedWithOutput
  })
})
