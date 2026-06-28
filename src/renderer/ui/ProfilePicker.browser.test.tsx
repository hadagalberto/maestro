import { render } from 'vitest-browser-react'
import { expect, test, vi, beforeEach } from 'vitest'
import { ProfilePicker } from './ProfilePicker'
import { useProject } from '../store/projectStore'

beforeEach(() => useProject.setState({ currentProject: '/p', trusted: false, recentProjects: [], problems: [], hasMaestroFile: true,
  profiles: [
    { id: 'shell', name: 'shell', command: 'bash', args: [], autoStart: false, source: 'preset' },
    { id: 'api', name: 'API', command: 'npm', args: [], autoStart: false, source: 'project' },
  ] }))

test('lista perfis e dispara onPick', async () => {
  const onPick = vi.fn()
  const screen = await render(<ProfilePicker onPick={onPick} onClose={() => {}} />)
  await expect.element(screen.getByText('shell')).toBeVisible()
  await expect.element(screen.getByText('API')).toBeVisible()
  await screen.getByText('API').click()
  expect(onPick).toHaveBeenCalled()
})
