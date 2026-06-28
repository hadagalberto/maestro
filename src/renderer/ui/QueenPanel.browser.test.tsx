import { render } from 'vitest-browser-react'
import { expect, test, vi } from 'vitest'
import { QueenPanel } from './QueenPanel'

test('mostra porta e url quando rodando', async () => {
  ;(window as any).term = { invoke: vi.fn().mockResolvedValue({ running: true, url: 'http://127.0.0.1:5599/mcp', port: 5599, token: 'abc' }) }
  const screen = await render(<QueenPanel onClose={() => {}} />)
  await expect.element(screen.getByText(/rodando na porta 5599/)).toBeVisible()
  await expect.element(screen.getByText('http://127.0.0.1:5599/mcp', { exact: true })).toBeVisible()
})
