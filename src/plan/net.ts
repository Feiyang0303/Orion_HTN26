import { report } from '../telemetry'

/* Where requests go. In the browser the defaults are right (Vite forwards
 * /api to the proxy, and Wikipedia/Nominatim are CORS-open). The fixture
 * script runs in Node, so it points `apiBase` at the proxy and sets a
 * User-Agent, which Wikipedia and Nominatim both ask for. */
export const net = {
  apiBase: '',
  headers: {} as Record<string, string>,
}

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { headers: net.headers, signal })
  if (!res.ok) {
    const host = new URL(url, 'http://x').hostname
    const err = new Error(`${host} answered ${res.status}`)
    report(err, `http.${host}`, { level: 'warning', extra: { status: res.status } })
    throw err
  }
  return res.json() as Promise<T>
}

async function postProxy(path: string, body: unknown): Promise<Response> {
  const res = await fetch(`${net.apiBase}/api/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!res.ok) {
    const msg = ((await res.json().catch(() => ({}))) as { error?: string }).error
    const err = new Error(`/api/${path}: ${msg || res.status}`) as Error & { status?: number }
    // The status rides along: a caller that can do something about 404 (this
    // will never work) but not about 502 (try again) needs to tell them apart.
    err.status = res.status
    if (res.status !== 501) report(err, `api.${path}`, { level: 'warning', extra: { status: res.status } })   // 501 = a key is not configured, which is setup, not a fault
    throw err
  }
  return res
}

export const postJson = async <T>(path: string, body: unknown): Promise<T> => (await postProxy(path, body)).json() as Promise<T>
export const postBytes = async (path: string, body: unknown): Promise<ArrayBuffer> => (await postProxy(path, body)).arrayBuffer()
/** The bytes and the response headers, for a caller that reads something off them. */
export const postBytesWith = async (path: string, body: unknown): Promise<{ bytes: ArrayBuffer; headers: Headers }> => {
  const res = await postProxy(path, body)
  return { bytes: await res.arrayBuffer(), headers: res.headers }
}
