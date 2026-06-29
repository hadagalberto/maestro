import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('trocar de projeto com terminal aberto → pergunta e fecha os antigos', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'maestro-e2e-sw-'))
  const projA = mkdtempSync(join(tmpdir(), 'maestro-projA-'))
  const projB = mkdtempSync(join(tmpdir(), 'maestro-projB-'))

  const app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`] })
  // showOpenDialog retorna A na 1ª chamada, B na 2ª
  await app.evaluate(async ({ dialog }, [a, b]) => {
    let n = 0
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [n++ === 0 ? a : b] })
  }, [projA, projB])
  const win = await app.firstWindow()
  await win.waitForSelector('text=Layout', { timeout: 20000 })

  // abre projeto A
  await win.getByRole('button', { name: /▾/ }).click()
  await win.getByRole('button', { name: 'Abrir pasta…' }).click()
  await win.waitForTimeout(300)

  // abre um terminal (preset shell)
  await win.getByRole('button', { name: '+ terminal' }).click()
  await win.getByRole('button', { name: /shell/ }).first().click()
  await expect(win.locator('.xterm-screen')).toHaveCount(1)

  // troca para o projeto B → diálogo aparece
  await win.getByRole('button', { name: /▾/ }).click()
  await win.getByRole('button', { name: 'Abrir pasta…' }).click()
  await expect(win.getByText('Projeto alterado')).toBeVisible({ timeout: 10000 })

  // Fechar → terminal antigo some
  await win.getByRole('button', { name: 'Fechar', exact: true }).click()
  await expect(win.locator('.xterm-screen')).toHaveCount(0)
  await app.close()
})
