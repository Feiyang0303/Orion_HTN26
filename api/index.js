/* The deployed twin of scripts/proxy.mjs: the same routes, shaped as one Vercel
 * function so the hosted page needs no local proxy. vercel.json rewrites every
 * /api/* request here with the rest of the path in `__path`; this puts the URL
 * back the way the proxy expects it. Keys come from the Vercel project's
 * environment variables. instrument.mjs goes first for the same reason it is
 * preloaded locally: Sentry has to see `http` and `fetch` before anyone uses them. */
import '../scripts/instrument.mjs'
import * as Sentry from '@sentry/node'
import { handle } from '../scripts/proxy.mjs'

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost')
  const path = url.searchParams.get('__path')
  if (path !== null) {
    url.searchParams.delete('__path')
    req.url = `/api/${path}${url.search}`
  }
  await handle(req, res)
  // A function may be frozen as soon as it returns, so reports go out now rather than later.
  if (process.env.SENTRY_DSN) await Sentry.flush(2000).catch(() => {})
}
