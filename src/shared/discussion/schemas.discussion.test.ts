import { describe, it, expect } from 'vitest'
import { discussionInput, summaryCardSchema, profileEntrySchema } from '../schemas'

describe('discussionInput', () => {
  it('exige >=2 participantes', () => {
    expect(discussionInput.safeParse({ topic: 't', templateKind: 'decision', orchestratorProfileId: 'c', participantProfileIds: ['a'], autonomous: true }).success).toBe(false)
    expect(discussionInput.safeParse({ topic: 't', templateKind: 'decision', orchestratorProfileId: 'c', participantProfileIds: ['a', 'b'], autonomous: true }).success).toBe(true)
  })
})
describe('summaryCardSchema', () => {
  it('valida card com dissents/actions', () => {
    expect(summaryCardSchema.safeParse({ kind: 'decision', title: 'x', body: 'y', dissents: ['z'], actions: [{ task: 'do' }] }).success).toBe(true)
  })
  it('rejeita kind inválido', () => {
    expect(summaryCardSchema.safeParse({ kind: 'bogus', title: 'x', body: 'y' }).success).toBe(false)
  })
})
describe('profileEntrySchema discuss', () => {
  it('aceita discuss opcional', () => {
    expect(profileEntrySchema.safeParse({ command: 'claude', discuss: { argsTemplate: ['-p', '{{prompt}}'] } }).success).toBe(true)
  })
})
