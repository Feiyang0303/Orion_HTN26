import { postJson } from './net'

export type Role = 'scout' | 'critic' | 'narrator'

/** One LLM call that must return a JSON object. Roles map to models in the proxy's env. */
export async function askJson<T>(role: Role, system: string, user: string, maxTokens = 2000): Promise<T> {
  const { text } = await postJson<{ text: string }>('llm', { role, system, user, maxTokens })
  try {
    const body = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? text
    return JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1)) as T
  } catch {
    throw new Error(`${role}: model did not return valid JSON`)
  }
}
