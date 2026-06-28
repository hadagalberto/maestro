import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('Queen server sobe e o painel mostra rodando', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'maestro-e2e-'))
  const app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`] })
  const win = await app.firstWindow()
  await win.waitForSelector('text=Layout', { timeout: 20000 })
  await win.getByRole('button', { name: 'Queen' }).click()
  await expect(win.getByText(/rodando na porta/)).toBeVisible({ timeout: 10000 })
  // o painel mostra a URL de loopback do servidor MCP embutido (http://127.0.0.1:<port>/mcp).
  // o regex casa tanto o <code> da URL quanto o comando "claude mcp add ..." que a inclui;
  // .first() garante o match sem violar o strict mode, mantendo o sentido da asserção.
  await expect(win.getByText(/127\.0\.0\.1:\d+\/mcp/).first()).toBeVisible()
  await app.close()
})
