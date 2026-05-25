import type { NetworkAdapter } from '@/types'
import { MSG, THR_EXT_MARKER } from '@/messaging'

export function createFetchWatcher(
  adapter: NetworkAdapter,
  originalFetch: typeof fetch,
) {
  let stagedSummaries: string[] = []
  let lastKnownRealLeaf: string | null = null

  window.addEventListener('summaryEnqueued', (e: Event) => {
    const customEvent = e as CustomEvent<{ text: string }>
    stagedSummaries.push(customEvent.detail.text)
  })

  function handleMessage(event: MessageEvent): void {
    if (event.source !== window) return
    const data = event.data as { type?: string; summaryTexts?: string[] }
    if (data?.type === MSG.STAGE_SUMMARY) {
      stagedSummaries = data.summaryTexts ?? []
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

    if (method === 'GET' && adapter.history?.urlPattern.test(url)) {
      const headers = requestHeaders(input, init)
      const response = await originalFetch(input, init)
      if (!response.ok) return response
      const json = await response.json()
      window.postMessage(
        { type: adapter.messages.endpointCaptured, url, body: json, headers },
        location.origin,
      )
      return new Response(JSON.stringify(adapter.history.filter(json, lastKnownRealLeaf)), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    }

    if (method !== 'POST' || !adapter.urlPattern.test(url)) {
      return originalFetch(input, init)
    }

    let body: unknown = null
    const rawBody = await requestBodyText(input, init)
    try {
      body = rawBody ? JSON.parse(rawBody) : null
    } catch {
      // Non-JSON body: adapter.inject only understands structured bodies, so skip
      // injection and keep staged summaries for the next request.
    }

    window.postMessage(
      {
        type: adapter.messages.endpointCaptured,
        url,
        body,
        headers: requestHeaders(input, init),
      },
      location.origin,
    )

    let injected = false
    let modifiedInit = init

    if (stagedSummaries.length > 0 && body !== null) {
      const result = adapter.inject(body, stagedSummaries)
      if (result.injected) {
        modifiedInit = { ...init, body: JSON.stringify(result.body) }
        stagedSummaries = []
        injected = true
        window.dispatchEvent(new CustomEvent('drainSummaries'))
      } else {
        console.warn('[fw] inject() could not match body shape — request shape may have changed. Summaries kept for next request. Body keys:', Object.keys(body as object))
      }
    }

    const response = await originalFetch(input, modifiedInit)
    if (!response.body) {
      if (injected) {
        window.postMessage({ type: adapter.messages.summaryInjected }, location.origin)
      }
      window.postMessage({ type: adapter.messages.streamComplete }, location.origin)
      return response
    }

    const isExtensionRequest =
      typeof (body as { prompt?: unknown })?.prompt === 'string' &&
      (body as { prompt: string }).prompt.startsWith(THR_EXT_MARKER)

    const [s1, s2] = response.body.tee()

    void (async () => {
      const reader = s2.getReader()
      const decoder = new TextDecoder()
      let leafExtracted = false
      let sseBuffer = ''
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = value !== undefined ? decoder.decode(value) : ''
          if (!isExtensionRequest && !leafExtracted && chunk) {
            sseBuffer += chunk
            const lines = sseBuffer.split('\n')
            // slice(0, -1) excludes the last potentially incomplete fragment
            for (const line of lines.slice(0, -1)) {
              if (!line.startsWith('data:')) continue
              try {
                const parsed = JSON.parse(line.slice(5).trim()) as {
                  type?: string
                  message?: { uuid?: string }
                }
                if (
                  parsed.type === 'message_start' &&
                  typeof parsed.message?.uuid === 'string'
                ) {
                  lastKnownRealLeaf = parsed.message.uuid
                  leafExtracted = true
                  break
                }
              } catch {
                // non-JSON data line — skip
              }
            }
            // Retain only the trailing incomplete fragment for the next chunk
            if (!leafExtracted) sseBuffer = lines[lines.length - 1]
          }
          if (chunk && adapter.isStreamDone?.(chunk)) break
        }
      } finally {
        reader.releaseLock()
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
