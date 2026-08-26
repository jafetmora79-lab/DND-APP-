import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'

function githubPagesArtifacts(): Plugin {
  return {
    name: 'github-pages-artifacts',
    apply: 'build',
    closeBundle() {
      const outDir = path.resolve(__dirname, 'dist')
      const index = path.join(outDir, 'index.html')
      if (!existsSync(index)) return
      copyFileSync(index, path.join(outDir, '404.html'))
      writeFileSync(path.join(outDir, '.nojekyll'), '')
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), githubPagesArtifacts()],
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
