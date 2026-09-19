import { agentCall, breadcrumb, log, report } from '../telemetry'
import { postJson } from './net'

export type Role = 'scout' | 'critic' | 'narrator'

/** One LLM call that must return a JSON object. Roles map to models in the proxy's env. */
export async function askJson<T>(role: Role, system: string, user: string, maxTokens = 2000): Promise<T> {
  const out = await agentCall(
    role, [{ role: 'system', content: system }, { role: 'user', content: user }],
    () => postJson<{ text: string; retried?: boolean }>('llm', { role, system, user, maxTokens }), r => r.text,
  )
  if (out.retried) {
    log.warn('model ran out of tokens; retried with a larger budget', { role })
    breadcrumb('llm', `${role} retried with a larger budget`, { role })
  }
  const text = out.text
  try {
    const body = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? text
    return JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1)) as T
  } catch {
    const err = new Error(`${role}: model did not return valid JSON`)
    report(err, `llm.${role}.json`, { level: 'warning', extra: { chars: text.length, head: text.slice(0, 120) } })
    throw err
  }
}
