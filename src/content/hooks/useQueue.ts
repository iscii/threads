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
import { createDebugLogger } from '@/debug'

let _networkAdapter: NetworkAdapter | null = null
const debug = createDebugLogger('queue')

export function initQueue(networkAdapter: NetworkAdapter): void {
  _networkAdapter = networkAdapter
  debug.log('queue initialized', () => ({ hasBuildCompletion: Boolean(networkAdapter.buildCompletion) }))
}

export async function sendThreadReply(threadId: string, userText: string): Promise<void> {
  const t = threads.value.find(t => t.id === threadId)
  if (!t) {
    debug.warn('reply skipped missing thread', () => ({ threadId }))
    return
  }

  debug.log('reply queued', () => ({ threadId, userTextLength: userText.length }))
  addMessage(threadId, { role: 'user', content: userText })

  const na = _networkAdapter
  const info = endpointInfo.value
  if (!na || !info) {
    debug.warn('reply skipped missing endpoint', () => ({
      threadId,
      hasAdapter: Boolean(na),
      hasEndpoint: Boolean(info),
    }))
    addMessage(threadId, {
      role: 'assistant',
      content: '(Send a message in the main chat first to initialize the connection.)',
    })
    return
  }

  const endpointURL = sameOriginURL(info.url)
  if (!endpointURL) {
    debug.warn('reply skipped non same-origin endpoint', () => ({ threadId }))
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
  debug.log('reply request built', () => ({
    threadId,
    persistedEndpoint: Boolean(info.persisted),
    body: describeValue(body),
  }))

  try {
    const res = await fetch(endpointURL, completionInit(info, body))
    debug.log('reply response received', () => ({ threadId, status: res.status, ok: res.ok }))
    if (!res.ok) throw new Error(`Thread reply failed with ${res.status}`)
    const reply = await accumulateSSE(res)
    debug.log('reply accumulated', () => ({ threadId, replyLength: reply.length }))
    addMessage(threadId, { role: 'assistant', content: reply || '(empty response)' })
  } catch {
    if (info.persisted) {
      debug.warn('reply failed with persisted endpoint; clearing vars', () => ({ threadId }))
      clearStoredEndpointInfo()
      addMessage(threadId, {
        role: 'assistant',
        content: '(Send a message in the main chat first to initialize the connection.)',
      })
      return
    }
    debug.warn('reply failed with live endpoint', () => ({ threadId }))
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

function describeValue(value: unknown): unknown {
  if (value === null) return { type: 'null' }
  if (Array.isArray(value)) return { type: 'array', length: value.length }
  if (typeof value === 'object') {
    return { type: 'object', keys: Object.keys(value as Record<string, unknown>) }
  }
  return { type: typeof value }
}
