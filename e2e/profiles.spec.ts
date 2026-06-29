import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, mkdirSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('abre projeto, modo restrito, confia, perfil shell roda', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'maestro-e2e-'))
  // monta um projeto temporário com maestro.yml
  const proj = mkdtempSync(join(tmpdir(), 'maestro-proj-'))
  copyFileSync(join(process.cwd(), 'e2e/fixtures/sample/maestro.yml'), join(proj, 'maestro.yml'))

  const app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`] })
  // stub do diálogo de pasta para retornar o projeto temporário
  await app.evaluate(async ({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
  }, proj)
  const win = await app.firstWindow()
  await win.waitForSelector('text=Layout', { timeout: 20000 })

  // abre projeto
  await win.getByRole('button', { name: 'Abrir projeto ▾' }).click()
  await win.getByRole('button', { name: 'Abrir pasta…' }).click()

  // modo restrito aparece (projeto define perfil que executa)
  await expect(win.getByText(/Modo Restrito/)).toBeVisible({ timeout: 10000 })
  // confia
  await win.getByRole('button', { name: 'Confiar', exact: true }).click()
  await expect(win.getByText(/Modo Restrito/)).toHaveCount(0)

  // abre um terminal via picker (preset shell, sempre válido)
  await win.getByRole('button', { name: '+ terminal' }).click()
  await win.getByRole('button', { name: /shell/ }).first().click()
  await expect(win.locator('.xterm-screen')).toHaveCount(1)
  const term = win.locator('.xterm-screen').first()
  await term.click()
  await expect(win.locator('.xterm-rows')).toContainText(/\$|>|PS /, { timeout: 20000 })
  await win.keyboard.type('echo MAESTROOK\r')
  await expect(win.locator('.xterm-rows')).toContainText('MAESTROOK', { timeout: 20000 })
  await app.close()
})

test('painel perfis globais abre e adiciona (sem crash de render-loop)', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'maestro-e2e-gp-'))
  const app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`] })
  const errors: string[] = []
  const win = await app.firstWindow()
  win.on('pageerror', (e) => errors.push(e.message))
  await win.waitForSelector('text=Layout', { timeout: 20000 })

  await win.getByRole('button', { name: 'perfis globais' }).click()
  await expect(win.getByPlaceholder('id')).toBeVisible({ timeout: 10000 })
  await win.getByPlaceholder('id').fill('meucli')
  await win.getByPlaceholder('command').fill('node')
  await win.getByRole('button', { name: 'add', exact: true }).click()
  await expect(win.getByText('meucli')).toBeVisible({ timeout: 10000 })
  expect(errors.join('\n')).not.toMatch(/Minified React error|Maximum update depth/)
  await app.close()
})
