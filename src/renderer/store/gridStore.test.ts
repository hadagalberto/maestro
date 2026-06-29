import { describe, it, expect, beforeEach } from 'vitest'
import { useGrid } from './gridStore'

beforeEach(() => useGrid.setState({ activeLayout: 'two', panes: [], activePaneId: null }))

describe('gridStore', () => {
  it('adiciona pane e marca como ativo', () => {
    useGrid.getState().addPane({ id: 't1', name: 'A', command: 'bash', cwd: '/tmp' })
    expect(useGrid.getState().panes).toHaveLength(1)
    expect(useGrid.getState().activePaneId).toBe('t1')
  })
  it('remove pane', () => {
    useGrid.getState().addPane({ id: 't1', name: 'A', command: 'bash', cwd: '/tmp' })
    useGrid.getState().removePane('t1')
    expect(useGrid.getState().panes).toHaveLength(0)
  })
  it('troca layout', () => {
    useGrid.getState().setLayout('quad')
    expect(useGrid.getState().activeLayout).toBe('quad')
  })
  it('removePaneTree remove descendentes', () => {
    useGrid.setState({ activeLayout: 'two', activePaneId: null, panes: [
      { id: 'a', name: 'a', command: 'x', cwd: '.' },
      { id: 'b', name: 'b', command: 'x', cwd: '.', parentId: 'a' },
      { id: 'c', name: 'c', command: 'x', cwd: '.', parentId: 'b' },
      { id: 'z', name: 'z', command: 'x', cwd: '.' },
    ] })
    const removed = useGrid.getState().removePaneTree('a')
    expect(removed.sort()).toEqual(['a', 'b', 'c'])
    expect(useGrid.getState().panes.map((p) => p.id)).toEqual(['z'])
  })
})
