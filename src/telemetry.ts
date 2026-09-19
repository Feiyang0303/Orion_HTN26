import * as Sentry from '@sentry/react'

/* One place that knows about Sentry. Everything else calls `report`,
 * `breadcrumb` or `tag`, so the rest of the code never imports the SDK and
 * nothing changes when there is no DSN: every call is a no-op (plus a console
 * line in dev), and the scripts that run this code in Node work unchanged.
 *
 * What we report is failures the user might never see: a fallback that
 * quietly took over (Routes down, voice failed, Overpass timing out), a bad
 * model reply, a tile that would not load. Those are the things that make a
 * demo feel broken with no error on screen, so they go up as warnings and the
 * crashes go up as errors.
 *
 * Nothing secret leaves the browser: Google's tile and Routes URLs carry the
 * API key and a session token as query parameters, and fetch breadcrumbs would
 * include them, so every URL is scrubbed on the way out. */

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}
const DSN = env.VITE_SENTRY_DSN
export const telemetryOn = !!DSN

const SECRET = /([?&](?:key|session|token|apikey|api_key)=)[^&#\s"']+/gi
// Key-shaped strings too: an upstream error can echo part of a key back ("Incorrect API key provided: sk-…").
const KEYLIKE = /\b(?:sk-[A-Za-z0-9_-]*\*{3,}[A-Za-z0-9]*|sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{20,}|xi-[A-Za-z0-9]{16,})/g
export const scrub = (s: string) => s.replace(SECRET, '$1[redacted]').replace(KEYLIKE, '[redacted-key]')

// Cycle-safe and shallow-bounded: Sentry's own event and span objects can be
// circular, and only plain objects and arrays hold strings worth scrubbing.
const scrubDeep = <T>(v: T, seen = new WeakSet<object>(), depth = 0): T => {
  if (typeof v === 'string') return scrub(v) as T
  if (v === null || typeof v !== 'object' || depth > 12 || seen.has(v)) return v
  const proto = Object.getPrototypeOf(v)
  if (!Array.isArray(v) && proto !== Object.prototype && proto !== null) return v
  seen.add(v)
  if (Array.isArray(v)) return v.map(x => scrubDeep(x, seen, depth + 1)) as T
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrubDeep(x, seen, depth + 1)])) as T
}

export function initTelemetry() {
  if (!DSN) return
  Sentry.init({
    dsn: DSN,
    environment: env.MODE,
    release: env.VITE_RELEASE,
    sendDefaultPii: false,
    // Everything is sampled while we are learning from it; turn these down for real traffic.
    tracesSampleRate: Number(env.VITE_SENTRY_TRACES ?? 1),
    replaysSessionSampleRate: Number(env.VITE_SENTRY_REPLAY ?? 1),
    replaysOnErrorSampleRate: 1,
    enableLogs: true,
    integrations: [
      Sentry.browserTracingIntegration(),
      // The book is public text we wrote, so it stays readable in a replay; what
      // people type into the desk does not. The WebGL canvas is not recorded.
      Sentry.replayIntegration({ maskAllInputs: true, maskAllText: false, blockAllMedia: false }),
    ],
    // Only our own /api gets trace headers. Anything else (Wikipedia, Nominatim,
    // Google) would need a CORS preflight for them, and would fail.
    tracePropagationTargets: [/^\/api\//, new RegExp(`^${((globalThis as { location?: { origin: string } }).location?.origin ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/api/`)],
    ignoreErrors: ['ResizeObserver loop', 'AbortError', 'The user aborted a request', 'Load failed'],
    beforeBreadcrumb: b => scrubDeep(b),
    beforeSend: e => scrubDeep(e),
    beforeSendTransaction: e => scrubDeep(e),
    beforeSendSpan: sp => scrubDeep(sp),
    beforeSendLog: l => scrubDeep(l),
  })
}

const isAbort = (e: unknown) => (e as { name?: string })?.name === 'AbortError'

// A tile server that is down fails hundreds of times a second; say it once a minute.
const seen = new Map<string, number>()
const THROTTLE_MS = 60_000

export type ReportOptions = {
  level?: 'warning' | 'error' | 'fatal' | 'info'
  extra?: Record<string, unknown>
  tags?: Record<string, string>
}

/** Report a failure. `where` is a stable dotted name ("router.matrix"), used as
    the grouping key, so the same fault is one issue and not one per message. */
export function report(error: unknown, where: string, opts: ReportOptions = {}) {
  if (isAbort(error)) return
  const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : JSON.stringify(error))
  if (env.DEV) console.warn(`[orion:${where}]`, err)
  if (!DSN) return
  const key = `${where}|${err.message}`
  const now = Date.now()
  if (now - (seen.get(key) ?? 0) < THROTTLE_MS) return
  seen.set(key, now)
  Sentry.withScope(scope => {
    scope.setTag('where', where)
    scope.setLevel(opts.level ?? 'error')
    scope.setFingerprint([where])
    for (const [k, v] of Object.entries(opts.tags ?? {})) scope.setTag(k, v)
    if (opts.extra) scope.setContext('detail', scrubDeep(opts.extra))
    Sentry.captureException(err)
  })
}

/** A trail the next error will carry: phase changes, crew steps, choices made. */
export function breadcrumb(category: string, message: string, data?: Record<string, unknown>) {
  if (!DSN) return
  Sentry.addBreadcrumb({ category, message, data: data && scrubDeep(data), level: 'info' })
}

/** Searchable facts about this session: the city, the phase, the plan id. */
export function tag(key: string, value: string | number | boolean) {
  if (DSN) Sentry.setTag(key, String(value))
}

export const lastEventId = () => (DSN ? Sentry.lastEventId() : undefined)

/* ---- structured logs -------------------------------------------------------
   Searchable in Sentry Logs, with attributes, and linked to the trace they
   happened in. In dev they also reach the console. */
type Attrs = Record<string, string | number | boolean | undefined>
const clean = (a?: Attrs) => Object.fromEntries(Object.entries(a ?? {}).filter(([, v]) => v !== undefined)) as Record<string, string | number | boolean>
const emit = (level: 'info' | 'warn' | 'error', msg: string, attrs?: Attrs) => {
  if (env.DEV) console.debug(`[orion:${level}]`, msg, attrs ?? '')
  if (DSN) Sentry.logger[level](scrub(msg), clean(attrs))
}
export const log = {
  info: (msg: string, attrs?: Attrs) => emit('info', msg, attrs),
  warn: (msg: string, attrs?: Attrs) => emit('warn', msg, attrs),
  error: (msg: string, attrs?: Attrs) => emit('error', msg, attrs),
}

/* ---- tracing ---------------------------------------------------------------
   Planning is a conversation: the person picks a bed, edits days, asks for a
   change. So each stage (open, beds, places, plan, revise) is its own
   transaction, and the crew's steps inside it are child spans, which makes
   "which stage is slow, and which step inside it" a question a trace answers. */
let stage: Sentry.Span | undefined

export function traced<A extends unknown[], R>(name: string, fn: (...a: A) => Promise<R>, attrs?: (...a: A) => Attrs) {
  return (...args: A): Promise<R> => {
    if (!DSN) return fn(...args)
    return Sentry.startSpan({ name, op: 'plan.stage', forceTransaction: true, attributes: clean(attrs?.(...args)) }, async span => {
      const outer = stage
      stage = span
      try { return await fn(...args) } catch (e) { span.setStatus({ code: 2, message: 'internal_error' }); throw e } finally { stage = outer }
    })
  }
}

/** One LLM call as an agent invocation, in Sentry's AI conventions. The proxy
    adds the model call underneath it, with the real token counts, and its own
    upstream request, so the trace reads browser → proxy → OpenAI. */
export function agentCall<T>(role: string, messages: { role: string; content: string }[], run: () => Promise<T>, response?: (r: T) => string): Promise<T> {
  if (!DSN) return run()
  return Sentry.startSpan({
    name: `invoke_agent ${role}`, op: 'gen_ai.invoke_agent', parentSpan: stage,
    attributes: {
      'gen_ai.operation.name': 'invoke_agent', 'gen_ai.agent.name': role, 'gen_ai.system': 'openai',
      'gen_ai.request.messages': JSON.stringify(messages).slice(0, 6000),
    },
  }, async span => {
    const r = await run()
    if (response) span.setAttribute('gen_ai.response.text', response(r).slice(0, 6000))
    return r
  })
}

const observed = new WeakSet<object>()

/** Wrap a crew event handler so each step is also telemetry. Tools (Geocode,
    Router, Timekeeper: plain code) become `execute_tool` spans between their
    "working" and "done" events; every event, tool or agent, becomes a log line
    and a breadcrumb. Wrapping twice is harmless. */
export function observeCrew<E extends { type: string }>(onEvent: (e: E) => void): (e: E) => void {
  if (!DSN || observed.has(onEvent)) return onEvent
  const open = new Map<string, Sentry.Span>()
  const wrapped = (e: E) => {
    const c = e as unknown as { agent?: string; kind?: string; state?: string; detail?: string }
    if (e.type === 'crew' && c.agent) {
      const attrs = { agent: c.agent, kind: c.kind, state: c.state, detail: c.detail?.slice(0, 300) }
      ;(c.state === 'failed' ? log.warn : log.info)(`${c.agent} ${c.state}: ${c.detail ?? ''}`.slice(0, 300), attrs)
      breadcrumb('crew', `${c.agent} ${c.state}`, attrs)
      if (c.kind === 'tool') {
        const key = c.agent
        if (c.state === 'working' && !open.has(key)) {
          open.set(key, Sentry.startInactiveSpan({
            name: `execute_tool ${c.agent}`, op: 'gen_ai.execute_tool', parentSpan: stage,
            attributes: { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': c.agent, detail: c.detail?.slice(0, 200) },
          }))
        } else if (c.state === 'done' || c.state === 'failed') {
          const sp = open.get(key)
          if (sp) { sp.setAttribute('result', c.detail?.slice(0, 200) ?? ''); if (c.state === 'failed') sp.setStatus({ code: 2, message: 'failed' }); sp.end(); open.delete(key) }
        }
      }
    }
    onEvent(e)
  }
  observed.add(wrapped)
  return wrapped
}

/** The flight as its own transaction, carrying what the viewer actually
    experienced: how often tiles were still loading, how long they took to
    settle, and frame rate. `preload` is tagged so on and off can be compared. */
export function startFlight(attrs: Attrs) {
  const span = DSN ? Sentry.startInactiveSpan({ name: 'flight', op: 'flight', forceTransaction: true, attributes: clean(attrs) }) : undefined
  return {
    end(result: Attrs & { outcome: string }) {
      if (!span) return
      span.setAttributes(clean(result))
      if (result.outcome !== 'finished') span.setStatus({ code: 2, message: result.outcome })
      span.end()
    },
  }
}

// Dev only: lets the console (or a test) trigger a report to check the pipeline end to end.
if (env.DEV) (globalThis as unknown as { __orionReport: unknown }).__orionReport = { report, breadcrumb, log }
