import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

// Tags every Sentry event with the commit it came from, so "fixed in" is checkable.
try { process.env.VITE_RELEASE ??= execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { /* not a git checkout */ }

// The browser never sees the OpenAI, TTS or Routes keys: every /api call is
// forwarded to scripts/proxy.mjs, which holds them.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': `http://127.0.0.1:${process.env.PROXY_PORT ?? 8787}` } },
})
