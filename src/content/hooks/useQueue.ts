import type { NetworkAdapter } from '@/types'
import {
  threads,
  endpointInfo,
  addMessage,
  setTyping,
  clearStoredEndpointInfo,
  type EndpointInfo,
} from '../lib/threads'
import { accumulateSSE } from '../lib/accumulateSSE'
import { sameOriginURL } from '../lib/endpoint'

let _networkAdapter: NetworkAdapter | null = null

export function initQueue(networkAdapter: NetworkAdapter): void {
  _networkAdapter = networkAdapter
}

export async function sendThreadReply(threadId: string, userText: string): Promise<void> {
  const t = threads.value.find(t => t.id === threadId)
  if (!t) return

  addMessage(threadId, { role: 'user', content: userText })

  const na = _networkAdapter
  const info = endpointInfo.value
  if (!na || !info) {
    addMessage(threadId, {
      role: 'assistant',
      content: '(Send a message in the main chat first to initialize the connection.)',
    })
    return
  }

  const endpointURL = sameOriginURL(info.url)
  if (!endpointURL) {
    addMessage(threadId, {
      role: 'assistant',
      content: '(Captured Claude endpoint was not same-origin; refusing to send credentials.)',
    })
    return
  }

  setTyping(threadId, true)

  const systemPrompt =
    `You are a concise assistant in a threaded discussion. ` +
    `Reply in 1–3 sentences. Do not repeat or quote the passage. ` +
    `Passage: "${t.blockText}"`

  const fresh = threads.value.find(th => th.id === threadId)
  const history = (fresh?.messages ?? [])
    .map(m => `${m.role === 'user' ? 'Human' : 'Assistant'}: ${m.content}`)
    .join('\n')
  const prompt = `${systemPrompt}\n\n${history}\n\nAssistant:`

  const body = na.buildCompletion(info.body, prompt)

  try {
    const res = await fetch(endpointURL, completionInit(info, body))
    if (!res.ok) throw new Error(`Thread reply failed with ${res.status}`)
    const reply = await accumulateSSE(res)
    addMessage(threadId, { role: 'assistant', content: reply || '(empty response)' })
  } catch {
    if (info.persisted) {
      clearStoredEndpointInfo()
      addMessage(threadId, {
        role: 'assistant',
        content: '(Send a message in the main chat first to initialize the connection.)',
      })
      return
    }
    addMessage(threadId, {
      role: 'assistant',
      content: '(Unable to reach Claude — the extension may need an update.)',
    })
  } finally {
    setTyping(threadId, false)
  }
}

function completionInit(info: EndpointInfo, body: unknown): RequestInit {
  return {
    method: 'POST',
    credentials: 'include',
    headers: {
      ...info.headers,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  }
}
