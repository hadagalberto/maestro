import { render } from 'vitest-browser-react'
import { expect, test, vi, beforeEach } from 'vitest'
import { GitPanel } from './GitPanel'
import { useGit } from '../store/gitStore'

beforeEach(() => {
  ;(window as any).term = { invoke: vi.fn().mockResolvedValue({ isRepo: true, branch: 'main', ahead: 0, behind: 0, hasRemote: true, staged: [], unstaged: [{ path: 'src/a.ts', status: 'modified', staged: false, added: 3, deleted: 1 }] }) }
  useGit.setState({ status: null, selected: null, diff: '', error: null, busy: false })
})

test('mostra branch e arquivo alterado', async () => {
  const screen = await render(<GitPanel onClose={() => {}} />)
  await expect.element(screen.getByText('main')).toBeVisible()
  await expect.element(screen.getByText('src/a.ts')).toBeVisible()
})
