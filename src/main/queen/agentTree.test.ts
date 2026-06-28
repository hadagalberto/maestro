import { describe, it, expect } from 'vitest'
import { AgentTree } from './agentTree'

const open = (t: AgentTree, id: string, parentId?: string) => t.open({ id, name: id, command: 'x', parentId })

describe('AgentTree', () => {
  it('tree() monta raízes e filhos', () => {
    const t = new AgentTree(() => 1)
    open(t, 'root'); open(t, 'child', 'root'); open(t, 'gchild', 'child')
    const tree = t.tree()
    expect(tree).toHaveLength(1)
    expect(tree[0].id).toBe('root')
    expect(tree[0].children[0].id).toBe('child')
    expect(tree[0].children[0].children[0].id).toBe('gchild')
  })
  it('pai ausente -> nó vira raiz', () => {
    const t = new AgentTree(() => 1)
    open(t, 'orphan', 'missing')
    expect(t.tree().map((n) => n.id)).toContain('orphan')
  })
  it('markExited marca status + devolve parentId', () => {
    const t = new AgentTree(() => 1)
    open(t, 'root'); open(t, 'child', 'root')
    const r = t.markExited('child', 0)
    expect(r).toEqual({ parentId: 'root' })
    expect(t.get('child')!.status).toBe('exited')
    expect(t.get('child')!.exitCode).toBe(0)
  })
  it('markExited em id inexistente -> null', () => {
    expect(new AgentTree(() => 1).markExited('nope', 1)).toBeNull()
  })
  it('awaitExit resolve já-exited', async () => {
    const t = new AgentTree(() => 1); open(t, 'a'); t.markExited('a', 7)
    await expect(t.awaitExit('a', 1000)).resolves.toEqual({ exitCode: 7 })
  })
  it('awaitExit resolve no exit posterior', async () => {
    const t = new AgentTree(() => 1); open(t, 'a')
    const p = t.awaitExit('a', 1000)
    t.markExited('a', 3)
    await expect(p).resolves.toEqual({ exitCode: 3 })
  })
  it('awaitExit timeout', async () => {
    const t = new AgentTree(() => 1); open(t, 'a')
    await expect(t.awaitExit('a', 10)).resolves.toBe('timeout')
  })
  it('awaitExit id inexistente -> gone', async () => {
    await expect(new AgentTree(() => 1).awaitExit('nope', 10)).resolves.toBe('gone')
  })
  it('close remove o nó', () => {
    const t = new AgentTree(() => 1); open(t, 'a'); t.close('a')
    expect(t.get('a')).toBeUndefined()
  })
})
