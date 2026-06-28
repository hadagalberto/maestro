import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

const alias = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: { alias },
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          ptyHostEntry: resolve('src/main/pty/ptyHostEntry.ts'),
        },
      },
    },
  },
  preload: {
    resolve: { alias },
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { output: { format: 'cjs' } } },
  },
  renderer: {
    resolve: { alias },
    plugins: [react(), tailwindcss()],
  },
})
