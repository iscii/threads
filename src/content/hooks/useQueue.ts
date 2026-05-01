import type { NetworkAdapter } from '@/types'
import { threads, endpointInfo, addMessage, setTyping } from '../lib/threads'
import { accumulateSSE } from '../lib/accumulateSSE'

let _networkAdapter: NetworkAdapter | null = null

export function initQueue(networkAdapter: NetworkAdapter): void {
  _networkAdapter = networkAdapter
}

export async function sendThreadReply(threadId: string, userText: string): Promise<void> {
  const na = _networkAdapter
  const info = endpointInfo.value
  const t = threads.value.find(t => t.id === threadId)
  if (!na || !info || !t) return

  addMessage(threadId, { role: 'user', content: userText })
  setTyping(threadId, true)

  const systemPrompt =
    `You are a concise assistant in a threaded discussion. ` +
    `Reply in 1–3 sentences. Do not repeat or quote the passage. ` +
    `Passage: "${t.blockText}"`

  const fresh = threads.value.find(t => t.id === threadId)
  const history = (fresh?.messages ?? [])
    .map(m => `${m.role === 'user' ? 'Human' : 'Assistant'}: ${m.content}`)
    .join('\n')
  const prompt = `${systemPrompt}\n\n${history}\n\nAssistant:`

  const body = na.buildCompletion(info.body, prompt)

  try {
    const res = await fetch(info.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const reply = await accumulateSSE(res)
    addMessage(threadId, { role: 'assistant', content: reply })
  } catch {
    addMessage(threadId, {
      role: 'assistant',
      content: '(Unable to reach Claude — the extension may need an update.)',
    })
  } finally {
    setTyping(threadId, false)
  }
}
