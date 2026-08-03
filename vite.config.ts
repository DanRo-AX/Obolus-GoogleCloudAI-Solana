import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      // @solana/web3.js still imports Node's `buffer` name. Point it at the
      // browser package so Vite does not externalize Buffer at runtime.
      buffer: 'buffer/',
      // @x402/svm keeps server-side verification helpers in the same browser
      // chunk as its client. Supply the small createHash surface those helpers
      // import instead of Vite's non-functional Node external.
      crypto: path.resolve(import.meta.dirname, './src/lib/cryptoBrowser.ts'),
    },
  },
  optimizeDeps: { include: ['buffer'] },
  server: {
    port: 4319,
    strictPort: true,
    host: true,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/healthz': 'http://127.0.0.1:8787',
    },
  },
  preview: {
    port: 4319,
    strictPort: true,
  },
})
