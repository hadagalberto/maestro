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
})
