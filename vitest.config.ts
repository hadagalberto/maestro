import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'
import { resolve } from 'node:path'

const alias = { '@shared': resolve('src/shared') }

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/main/**/*.test.ts', 'src/shared/**/*.test.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'pane',
          include: ['src/renderer/**/*.test.{ts,tsx}'],
          browser: {
            enabled: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
