import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Rutas internas de Monaco para la entrada reducida (src/components/code/monaco-slim.js).
      '@monaco-esm': path.resolve(__dirname, './node_modules/monaco-editor/esm/vs'),
    },
  },
  // Se pre-empaqueta para que la primera generación del PDF no fuerce una recarga en desarrollo.
  optimizeDeps: {
    include: ['@react-pdf/renderer'],
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})
