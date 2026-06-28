import { render } from 'vitest-browser-react'
import { expect, test, vi, beforeEach } from 'vitest'

// Headless chromium tem WebGL2, então o WebglAddon renderiza num <canvas>
// (sem nós de texto no DOM) e getByText não acha nada. Forçamos o DOM
// renderer do xterm fazendo o WebglAddon ser um no-op no ambiente de teste.
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    activate() {}
    dispose() {}
    onContextLoss() {}
  },
}))

import { TerminalPane } from './TerminalPane'

beforeEach(() => {
  ;(window as unknown as { term: unknown }).term = {
    invoke: vi.fn().mockResolvedValue(undefined),
    onPtyData: (_id: string, cb: (p: { data: string }) => void) => {
      ;(window as unknown as { __emit: (d: string) => void }).__emit = (d) => cb({ data: d })
      return () => {}
    },
    onPtyExit: () => () => {},
  }
})

test('escreve output do PTY no buffer do xterm', async () => {
  const screen = await render(<TerminalPane pane={{ id: 'p1', name: 'A', command: 'bash', cwd: '/tmp' }} />)
  await vi.waitFor(() => expect((window as unknown as { __emit?: unknown }).__emit).toBeTypeOf('function'))
  ;(window as unknown as { __emit: (d: string) => void }).__emit('READY\r\n')
  await expect.element(screen.getByText('READY')).toBeVisible()
})
