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
  if (!res.ok) throw new Error(`${new URL(url, 'http://x').hostname} answered ${res.status}`)
  return res.json() as Promise<T>
}

async function postProxy(path: string, body: unknown): Promise<Response> {
  const res = await fetch(`${net.apiBase}/api/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!res.ok) {
    const msg = ((await res.json().catch(() => ({}))) as { error?: string }).error
    throw new Error(`/api/${path}: ${msg || res.status}`)
  }
  return res
}

export const postJson = async <T>(path: string, body: unknown): Promise<T> => (await postProxy(path, body)).json() as Promise<T>
export const postBytes = async (path: string, body: unknown): Promise<ArrayBuffer> => (await postProxy(path, body)).arrayBuffer()
