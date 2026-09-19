import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { execSync } from 'node:child_process'

// Tags every Sentry event with the commit it came from, so "fixed in" is checkable.
try { process.env.VITE_RELEASE ??= execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { /* not a git checkout */ }

// The browser never sees the OpenAI, TTS or Routes keys: every /api call is
// forwarded to scripts/proxy.mjs, which holds them.
// `npm run vr` serves over HTTPS on the LAN: a headset's browser only offers WebXR on a
// secure origin, and the self-signed certificate is the price of not needing a domain.
const VR = !!process.env.VR
export default defineConfig({
  plugins: [react(), ...(VR ? [basicSsl()] : [])],
  server: { host: VR ? true : undefined, proxy: { '/api': `http://127.0.0.1:${process.env.PROXY_PORT ?? 8787}` } },
})
