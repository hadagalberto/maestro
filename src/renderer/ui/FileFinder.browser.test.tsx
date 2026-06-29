import { render } from 'vitest-browser-react'
import { expect, test, vi, beforeEach } from 'vitest'
import { FileFinder } from './FileFinder'
import { useFiles } from '../store/filesStore'

beforeEach(() => {
  ;(window as any).term = { invoke: vi.fn().mockResolvedValue(['src/app.ts', 'src/main.ts', 'README.md']) }
  useFiles.setState({ files: ['src/app.ts', 'src/main.ts', 'README.md'], loaded: true, viewer: null, results: [], searching: false })
})

test('filtra fuzzy ao digitar', async () => {
  const screen = await render(<FileFinder onClose={() => {}} />)
  const input = screen.getByPlaceholder('buscar arquivo…')
  await input.fill('app')
  // FileFinder renders each path char in its own <span>, so assert via container textContent.
  await expect.element(screen.container).toHaveTextContent('app.ts')
  await expect.element(screen.container).not.toHaveTextContent('README.md')
})
