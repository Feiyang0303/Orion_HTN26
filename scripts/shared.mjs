/* Small pieces shared by the proxy and its Sentry preload (instrument.mjs). */
import { readFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'

/** A minimal .env loader, so `npm run dev` needs no extra dependency. Real environment wins. */
export function loadEnv(file = '.env') {
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && !line.trimStart().startsWith('#') && !(m[1] in process.env)) process.env[m[1]] = m[2]
  }
}

/* Upstream errors can echo part of an API key back ("Incorrect API key provided:
   sk-…"), and Google's URLs carry the key and a session token as query
   parameters, so every string that leaves this process is scrubbed. */
export const scrub = str => String(str)
  .replace(/mongodb(?:\+srv)?:\/\/[^@\s/]+@/gi, 'mongodb://[redacted]@')
  .replace(/([?&](?:key|session|token|apikey|api_key)=)[^&#\s"']+/gi, '$1[redacted]')
  .replace(/\b(?:sk-[A-Za-z0-9_-]*\*{3,}[A-Za-z0-9]*|sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{20,}|xi-[A-Za-z0-9]{16,})/g, '[redacted-key]')
// Cycle-safe and bounded: Sentry's own event and span objects can be circular.
export const scrubDeep = (v, seen = new WeakSet(), depth = 0) => {
  if (typeof v === 'string') return scrub(v)
  if (v === null || typeof v !== 'object' || depth > 12 || seen.has(v)) return v
  const proto = Object.getPrototypeOf(v)
  if (!Array.isArray(v) && proto !== Object.prototype && proto !== null) return v
  seen.add(v)
  return Array.isArray(v) ? v.map(x => scrubDeep(x, seen, depth + 1))
    : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrubDeep(x, seen, depth + 1)]))
}

export const gitSha = () => { try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { return undefined } }
