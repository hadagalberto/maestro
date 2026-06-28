import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('inicia discussão decision com perfis echo e vê turnos + card', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'maestro-e2e-'))
  const proj = mkdtempSync(join(tmpdir(), 'maestro-proj-'))
  copyFileSync(join(process.cwd(), 'e2e/fixtures/discuss/maestro.yml'), join(proj, 'maestro.yml'))

  const app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`] })
  await app.evaluate(async ({ dialog }, dir) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] }) }, proj)
  const win = await app.firstWindow()
  await win.waitForSelector('text=Layout', { timeout: 20000 })

  await win.getByRole('button', { name: 'Abrir projeto ▾' }).click()
  await win.getByRole('button', { name: 'Abrir pasta…' }).click()
  await win.getByText(/Modo Restrito/).waitFor({ timeout: 10000 })
  await win.getByRole('button', { name: 'Confiar', exact: true }).click()
  // após confiar, os perfis do projeto (pro/con/orch) ficam disponíveis no modal
  await expect(win.getByText(/Modo Restrito/)).toHaveCount(0)

  await win.getByRole('button', { name: '+ discussão' }).click()
  // template decision já é o default; preenche tópico
  await win.locator('textarea').fill('spaces vs tabs')
  // orquestrador = orch (option label "Orchestrator")
  await win.locator('select').selectOption({ label: 'Orchestrator' })
  // participantes pro + con (botões rendem o name com um dot de cor)
  await win.getByRole('button', { name: 'Pro', exact: true }).click()
  await win.getByRole('button', { name: 'Con', exact: true }).click()
  await win.getByRole('button', { name: 'Start discussion' }).click()

  // turnos aparecem na DiscussionView
  await expect(win.getByText(/PRO: spaces are better/)).toBeVisible({ timeout: 30000 })
  await expect(win.getByText(/CON: tabs are better/)).toBeVisible({ timeout: 30000 })
  // card de decisão com corpo + dissensos
  // (o turno de síntese mostra o JSON cru e o card mostra só o body; usa exact pra
  //  casar o body do card de decisão, não o JSON do turno)
  await expect(win.getByText('spaces vencem', { exact: true })).toBeVisible({ timeout: 30000 })
  await expect(win.getByText(/Dissensos/)).toBeVisible({ timeout: 30000 })
  await app.close()
})
