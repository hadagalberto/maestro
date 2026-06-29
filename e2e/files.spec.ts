import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import which from 'which'

const git = which.sync('git', { nothrow: true })
test.skip(!git, 'git required')
test('file finder lista e abre um arquivo do projeto', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'maestro-e2e-'))
  const proj = mkdtempSync(join(tmpdir(), 'maestro-proj-'))
  execFileSync(git!, ['init', '-q'], { cwd: proj })
  mkdirSync(join(proj, 'src'))
  writeFileSync(join(proj, 'src', 'widget.ts'), 'export const widget = 42\n')

  const app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`] })
  await app.evaluate(async ({ dialog }, dir) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] }) }, proj)
  const win = await app.firstWindow()
  await win.waitForSelector('text=Layout', { timeout: 20000 })
  await win.getByRole('button', { name: 'Abrir projeto ▾' }).click()
  await win.getByRole('button', { name: 'Abrir pasta…' }).click()
  await win.getByRole('button', { name: 'Arquivos', exact: true }).click()
  await win.getByPlaceholder('buscar arquivo…').fill('widget')
  await win.getByText(/widget\.ts/).first().click()
  await expect(win.getByText(/export const widget/)).toBeVisible({ timeout: 10000 })
  await app.close()
})
