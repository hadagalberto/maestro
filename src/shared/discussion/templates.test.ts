import { describe, it, expect } from 'vitest'
import { assignRoles, buildFlow } from './templates'

describe('assignRoles', () => {
  it('decision: pro/con + panelist', () => {
    expect(assignRoles('decision', ['a', 'b', 'c']).map((p) => p.role)).toEqual(['pro', 'con', 'panelist'])
  })
  it('review: defender/attacker', () => {
    expect(assignRoles('review', ['a', 'b']).map((p) => p.role)).toEqual(['defender', 'attacker'])
  })
  it('brainstorm: todos ideator', () => {
    expect(assignRoles('brainstorm', ['a', 'b']).every((p) => p.role === 'ideator')).toBe(true)
  })
  it('dev-squad: builder-N', () => {
    expect(assignRoles('dev-squad', ['a', 'b']).map((p) => p.role)).toEqual(['builder-1', 'builder-2'])
  })
})

describe('buildFlow', () => {
  it('decision tem fase de diverge, rebut (repeat) e decisão (synthesize decision)', () => {
    const flow = buildFlow('decision', assignRoles('decision', ['a', 'b']))
    expect(flow.kind).toBe('decision')
    expect(flow.phases.some((p) => p.synthesize?.card === 'decision')).toBe(true)
    expect(flow.phases.some((p) => p.repeat)).toBe(true)
  })
  it('plan: product+eng paralelo e synthesize plan', () => {
    const flow = buildFlow('plan', assignRoles('plan', ['a', 'b']))
    expect(flow.phases.some((p) => p.synthesize?.card === 'plan')).toBe(true)
  })
  it('custom: fase all + synthesize note', () => {
    const flow = buildFlow('custom', assignRoles('custom', ['a', 'b']))
    expect(flow.phases.length).toBeGreaterThanOrEqual(2)
  })
})
