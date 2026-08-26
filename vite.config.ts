import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: process.env.VITE_BASE || '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 4731,
    allowedHosts: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4732', changeOrigin: true },
      '/uploads': { target: 'http://127.0.0.1:4732', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:4732', ws: true },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4731,
  },
})
