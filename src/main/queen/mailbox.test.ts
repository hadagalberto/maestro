import { describe, it, expect } from 'vitest'
import { Mailbox } from './mailbox'

describe('Mailbox', () => {
  it('send + inbox', () => {
    const m = new Mailbox(() => 'id1', () => 100)
    m.send({ from: 'a', to: 'b', text: 'oi' })
    const inbox = m.inbox('b')
    expect(inbox).toHaveLength(1)
    expect(inbox[0]).toMatchObject({ from: 'a', to: 'b', text: 'oi', read: false })
  })
  it('unreadOnly filtra lidas', () => {
    let i = 0
    const m = new Mailbox(() => `id${i++}`, () => 1)
    m.send({ from: 'a', to: 'b', text: '1' })
    m.send({ from: 'a', to: 'b', text: '2' })
    const first = m.inbox('b', { markRead: true })
    expect(first).toHaveLength(2)
    expect(m.inbox('b', { unreadOnly: true })).toHaveLength(0)
  })
  it('cap por destinatário', () => {
    let i = 0
    const m = new Mailbox(() => `id${i++}`, () => 1, 3)
    for (let k = 0; k < 5; k++) m.send({ from: 'a', to: 'b', text: String(k) })
    expect(m.inbox('b').length).toBe(3)
  })
})
