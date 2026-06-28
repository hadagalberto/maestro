import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

const alias = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: { alias },
    // strip-ansi (and its dep ansi-regex) are ESM-only; externalizing them leaves a
    // bare require() in the CJS main bundle which throws ERR_REQUIRE_ESM at runtime.
    // Bundle them instead so they are emitted as CJS-compatible code.
    plugins: [externalizeDepsPlugin({ exclude: ['strip-ansi', 'ansi-regex'] })],
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
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } },
  },
  renderer: {
    resolve: { alias },
    plugins: [react(), tailwindcss()],
  },
})
