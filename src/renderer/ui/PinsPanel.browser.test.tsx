import { render } from 'vitest-browser-react'
import { expect, test, vi, beforeEach } from 'vitest'
import { PinsPanel } from './PinsPanel'
import { usePins } from '../store/pinsStore'

beforeEach(() => {
  ;(window as any).term = { invoke: vi.fn().mockImplementation((ch: string) => ch === 'pins:list' ? Promise.resolve([{ id: 'p1', text: 'fazer X', done: false, createdAt: 1 }]) : ch === 'notes:get' ? Promise.resolve('minhas notas') : Promise.resolve([])) }
  usePins.setState({ pins: [], notes: '' })
})

test('mostra pins e notes', async () => {
  const screen = await render(<PinsPanel onClose={() => {}} />)
  await expect.element(screen.getByText('fazer X')).toBeVisible()
  await expect.element(screen.getByPlaceholder('scratchpad do projeto…')).toHaveValue('minhas notas')
})
