import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The browser never sees the OpenAI, TTS or Routes keys: every /api call is
// forwarded to scripts/proxy.mjs, which holds them.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
})
