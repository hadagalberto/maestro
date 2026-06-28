import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('app abre e spawna um terminal', async () => {
  // userData isolado por run: senão panes persistidos (electron-store) acumulam entre execuções
  const userDataDir = mkdtempSync(join(tmpdir(), 'hiveterm-e2e-'))
  const app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`] })
  await app.evaluate(async ({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })
  })
  const win = await app.firstWindow()

  await win.getByRole('button', { name: '+ terminal' }).click()
  // o botão "+ terminal" agora abre o seletor de perfis; escolhe o preset shell
  await win.getByRole('button', { name: /shell/ }).first().click()
  await expect(win.locator('.xterm-screen')).toHaveCount(1)

  // o terminal precisa de foco pra receber as teclas (o clique anterior focou o botão)
  const term = win.locator('.xterm-screen').first()
  await term.click()
  // espera o shell estar pronto (prompt impresso) antes de digitar
  await expect(win.locator('.xterm-rows')).toContainText(/PS |\$|>/, { timeout: 20_000 })

  await win.keyboard.type('echo HIVEOK\r')
  await expect(win.locator('.xterm-rows')).toContainText('HIVEOK', { timeout: 20_000 })

  await app.close()
})
