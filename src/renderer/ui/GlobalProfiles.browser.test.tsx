import { render } from 'vitest-browser-react'
import { expect, test, vi, beforeEach } from 'vitest'
import { GlobalProfiles } from './GlobalProfiles'
import { useProject } from '../store/projectStore'

const emptyState = { currentProject: null, recentProjects: [], trusted: true, profiles: [], problems: [], hasMaestroFile: false }
let invoke: ReturnType<typeof vi.fn>

beforeEach(() => {
  invoke = vi.fn().mockResolvedValue(emptyState)
  ;(window as unknown as { term: unknown }).term = { invoke }
  useProject.setState(emptyState as never)
})

test('marcar yolo → profiles:setGlobal com yolo:true', async () => {
  const screen = await render(<GlobalProfiles onClose={() => {}} />)
  await screen.getByPlaceholder('id').fill('myc')
  await screen.getByPlaceholder('command').fill('claude')
  await screen.getByRole('checkbox').click()
  await screen.getByRole('button', { name: 'add' }).click()
  const call = invoke.mock.calls.find((c) => c[0] === 'profiles:setGlobal')
  expect(call).toBeTruthy()
  expect(call![1].profiles.myc.yolo).toBe(true)
})
