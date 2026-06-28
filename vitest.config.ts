import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import { resolve } from 'node:path'

const alias = { '@shared': resolve('src/shared') }

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: { name: 'unit', environment: 'node', include: ['src/**/*.test.ts'] },
      },
      {
        resolve: { alias, dedupe: ['react', 'react-dom'] },
        optimizeDeps: { include: ['react', 'react-dom', 'react/jsx-dev-runtime', 'zustand'] },
        test: {
          name: 'pane',
          include: ['src/**/*.browser.test.tsx'],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
