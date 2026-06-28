import { test, expect, _electron as electron } from '@playwright/test'

test('app abre e spawna um terminal', async () => {
  const app = await electron.launch({ args: ['.'] })
  await app.evaluate(async ({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })
  })
  const win = await app.firstWindow()
  await win.getByRole('button', { name: '+ terminal' }).click()
  await expect(win.locator('.xterm-screen')).toHaveCount(1)
  await win.keyboard.type('echo hi\n')
  await expect(win.getByText('hi')).toBeVisible({ timeout: 15_000 })
  await app.close()
})
