/* Loaded before the proxy (node --import ./scripts/instrument.mjs): in ESM,
 * Sentry has to be initialised before `http` and `fetch` are first used, or its
 * automatic spans for them never attach. With no SENTRY_DSN this does nothing
 * and every Sentry call in the proxy is a no-op. */
import * as Sentry from '@sentry/node'
import { loadEnv, scrubDeep, gitSha } from './shared.mjs'

loadEnv()
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENV || 'development',
    release: process.env.SENTRY_RELEASE || gitSha(),
    sendDefaultPii: false,
    tracesSampleRate: Number(process.env.SENTRY_TRACES ?? 1),
    enableLogs: true,
    // Wrapped, not passed directly: Sentry calls these with a second argument (a hint) that would land in scrubDeep's `seen`.
    beforeSend: e => scrubDeep(e), beforeBreadcrumb: b => scrubDeep(b), beforeSendTransaction: e => scrubDeep(e),
    beforeSendSpan: sp => scrubDeep(sp), beforeSendLog: l => scrubDeep(l),
  })
  Sentry.setTag('service', 'orion-proxy')
}
