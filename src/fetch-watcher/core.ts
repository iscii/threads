import type { NetworkAdapter } from '@/types'
import { MSG } from '@/messaging'
import { createDebugLogger } from '@/debug'

const debug = createDebugLogger('fetch-watcher')

export function createFetchWatcher(
  adapter: NetworkAdapter,
  originalFetch: typeof fetch,
) {
  let stagedSummaries: string[] = []

  window.addEventListener('summaryEnqueued', (e: Event) => {
    const customEvent = e as CustomEvent<{ text: string }>
    stagedSummaries.push(customEvent.detail.text)
    debug.log('summary staged from event', () => ({ stagedCount: stagedSummaries.length }))
  })

  function handleMessage(event: MessageEvent): void {
    if (event.source !== window) return
    const data = event.data as { type?: string; summaryTexts?: string[] }
    if (data?.type === MSG.STAGE_SUMMARY) {
      stagedSummaries = data.summaryTexts ?? []
      debug.log('summary stage message received', () => ({ stagedCount: stagedSummaries.length }))
    }
  }

  async function interceptFetch(
    input: RequestInfo | URL,
    init: RequestInit = {},
  ): Promise<Response> {
    const url = input instanceof Request ? input.url : String(input)
    const method = (
      init.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase()
    const matchesCompletion = matchesPattern(adapter.urlPattern, url)
    const matchesHistory = adapter.history
      ? matchesPattern(adapter.history.urlPattern, url)
      : false

    if (method === 'GET' && adapter.history && matchesHistory) {
      const headers = requestHeaders(input, init)
      const response = await originalFetch(input, init)
      if (!response.ok) {
        debug.warn('history capture skipped for non-ok response', () => ({
          url: safeUrl(url),
          status: response.status,
        }))
        return response
      }
      const json = await response.json()
      debug.log('history endpoint captured', () => ({
        url: safeUrl(url),
        body: describeValue(json),
        headerKeys: headers ? Object.keys(headers) : [],
      }))
      window.postMessage(
        { type: adapter.messages.endpointCaptured, url, body: json, headers },
        location.origin,
      )
      return new Response(JSON.stringify(adapter.history.filter(json)), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    }

    if (method !== 'POST' || !matchesCompletion) {
      return originalFetch(input, init)
    }

    let body: unknown = null
    const rawBody = await requestBodyText(input, init)
    try {
      body = rawBody ? JSON.parse(rawBody) : null
    } catch {
      // Non-JSON body: adapter.inject only understands structured bodies, so skip
      // injection and keep staged summaries for the next request.
      debug.warn('request body parse failed', () => ({
        url: safeUrl(url),
        hasBody: rawBody !== null,
      }))
    }

    const headers = requestHeaders(input, init)
    debug.log('completion endpoint captured', () => ({
      url: safeUrl(url),
      body: describeValue(body),
      headerKeys: headers ? Object.keys(headers) : [],
    }))

    window.postMessage(
      {
        type: adapter.messages.endpointCaptured,
        url,
        body,
        headers,
      },
      location.origin,
    )

    let injected = false
    let modifiedInit = init

    if (stagedSummaries.length > 0 && body !== null) {
      const result = adapter.inject(body, stagedSummaries)
      if (result.injected) {
        modifiedInit = { ...init, body: JSON.stringify(result.body) }
        debug.log('summaries injected', () => ({
          url: safeUrl(url),
          stagedCount: stagedSummaries.length,
          resultBody: describeValue(result.body),
        }))
        stagedSummaries = []
        injected = true
        window.dispatchEvent(new CustomEvent('drainSummaries'))
      } else {
        debug.warn('summary injection skipped by adapter', () => ({
          url: safeUrl(url),
          stagedCount: stagedSummaries.length,
          body: describeValue(body),
        }))
      }
    }

    const response = await originalFetch(input, modifiedInit)
    if (!response.body) {
      debug.warn('response has no stream body', () => ({
        url: safeUrl(url),
        injected,
        status: response.status,
      }))
      if (injected) {
        window.postMessage({ type: adapter.messages.summaryInjected }, location.origin)
      }
      window.postMessage({ type: adapter.messages.streamComplete }, location.origin)
      return response
    }

    const [s1, s2] = response.body.tee()

    void (async () => {
      const reader = s2.getReader()
      const decoder = new TextDecoder()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value !== undefined && adapter.isStreamDone?.(decoder.decode(value))) {
            debug.log('stream completion marker observed', () => ({ url: safeUrl(url) }))
            break
          }
        }
      } finally {
        reader.releaseLock()
        debug.log('stream complete', () => ({ url: safeUrl(url), injected }))
        window.postMessage({ type: adapter.messages.streamComplete }, location.origin)
      }
    })()

    if (injected) {
      window.postMessage({ type: adapter.messages.summaryInjected }, location.origin)
    }

    return new Response(s1, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }

  return { interceptFetch, handleMessage }
}

function safeUrl(url: string): string {
  try {
    const parsed = new URL(url, location.origin)
    return parsed.pathname
  } catch {
    return '[unparseable-url]'
  }
}

function matchesPattern(pattern: RegExp, url: string): boolean {
  pattern.lastIndex = 0
  const matches = pattern.test(url)
  pattern.lastIndex = 0
  return matches
}

function describeValue(value: unknown): unknown {
  if (value === null) return { type: 'null' }
  if (Array.isArray(value)) return { type: 'array', length: value.length }
  if (typeof value === 'object') {
    return { type: 'object', keys: Object.keys(value as Record<string, unknown>) }
  }
  return { type: typeof value }
}

async function requestBodyText(
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<string | null> {
  if (typeof init.body === 'string') return init.body
  if (input instanceof Request) {
    try {
      return await input.clone().text()
    } catch {
      return null
    }
  }
  return null
}

function requestHeaders(
  input: RequestInfo | URL,
  init: RequestInit,
): Record<string, string> | undefined {
  const headers = new Headers(input instanceof Request ? input.headers : undefined)
  if (init.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value))
  }

  const record: Record<string, string> = {}
  headers.forEach((value, key) => {
    if (isStorableHeader(key)) record[key] = value
  })
  return Object.keys(record).length ? record : undefined
}

function isStorableHeader(key: string): boolean {
  return ![
    'authorization',
    'content-length',
    'cookie',
    'host',
  ].includes(key.toLowerCase())
}
