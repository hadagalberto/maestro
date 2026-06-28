import { render } from 'vitest-browser-react'
import { expect, test, vi, beforeEach } from 'vitest'
import { NewDiscussionModal } from './NewDiscussionModal'
import { useProject } from '../store/projectStore'

beforeEach(() => useProject.setState({ currentProject: null, trusted: true, recentProjects: [], problems: [], hasMaestroFile: false,
  profiles: [
    { id: 'claude', name: 'claude', command: 'claude', args: [], autoStart: false, source: 'preset' },
    { id: 'codex', name: 'codex', command: 'codex', args: [], autoStart: false, source: 'preset' },
  ] }))

test('exige >=2 participantes antes de iniciar', async () => {
  ;(window as any).term = { invoke: vi.fn().mockResolvedValue({ id: 'd1' }) }
  const screen = await render(<NewDiscussionModal onClose={() => {}} onStarted={() => {}} />)
  await screen.getByText('Start discussion').click()
  await expect.element(screen.getByText(/ao menos 2/)).toBeVisible()
})
