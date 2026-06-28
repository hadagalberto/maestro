import { render } from 'vitest-browser-react'
import { expect, test, beforeEach } from 'vitest'
import { RestrictedBanner } from './RestrictedBanner'
import { useProject } from '../store/projectStore'

beforeEach(() => useProject.setState({ currentProject: '/p', trusted: false, profiles: [{ id: 'api', name: 'API', command: 'npm', args: [], autoStart: false, source: 'project' }], recentProjects: [], problems: [], hasMaestroFile: true }))

test('mostra banner quando projeto não confiável tem perfil de projeto', async () => {
  const screen = await render(<RestrictedBanner />)
  await expect.element(screen.getByText(/Modo Restrito/)).toBeVisible()
})
test('some quando confiável', async () => {
  useProject.setState({ trusted: true })
  const screen = await render(<RestrictedBanner />)
  expect(screen.container.textContent ?? '').not.toContain('Modo Restrito')
})
