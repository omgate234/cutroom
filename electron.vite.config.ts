import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: shared },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          mcp: resolve('src/mcp/server.ts'),
          cli: resolve('src/mcp/cli.ts')
        }
      }
    }
  },
  preload: {},
  renderer: {
    resolve: { alias: { '@': resolve('src/renderer/src'), ...shared } },
    plugins: [react(), tailwindcss()]
  }
})
