import { render } from 'vitest-browser-react'
import { expect, test, beforeEach } from 'vitest'
import { AgentTreeView } from './AgentTreeView'
import { useGrid } from '../store/gridStore'

beforeEach(() => useGrid.setState({
  activeLayout: 'two', activePaneId: null, exited: { c1: 0 },
  panes: [
    { id: 'p1', name: 'Parent', command: 'claude', cwd: '.' },
    { id: 'c1', name: 'Child', command: 'codex', cwd: '.', parentId: 'p1' },
  ],
}))

test('mostra pai e filho (indentado) + status', async () => {
  const screen = await render(<AgentTreeView />)
  await expect.element(screen.getByText('Parent')).toBeVisible()
  await expect.element(screen.getByText('Child')).toBeVisible()
})
