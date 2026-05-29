import type { NetworkAdapter } from '@/types'
import { MSG } from '@/messaging'

export function createFetchWatcher(
  adapter: NetworkAdapter,
  originalFetch: typeof fetch,
) {
  let stagedSummaries: string[] = []

  function parseJSONBody(init: RequestInit): unknown | null {
    try {
      if (typeof init.body !== 'string') return null
      return JSON.parse(init.body) as unknown
    } catch {
      return null
    }
  }

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
      const response = await originalFetch(input, init)
      if (!response.ok) return response
      const json = await response.json()
      return new Response(JSON.stringify(adapter.history.filter(json)), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    }

    if (method !== 'POST' || !adapter.urlPattern.test(url)) {
      const runtimeBody = parseJSONBody(init)
      if (runtimeBody !== null) {
        adapter.observeRuntimeValues?.(url, runtimeBody)
        if (adapter.messages.runtimeValues) {
          window.postMessage(
            { type: adapter.messages.runtimeValues, url, body: runtimeBody },
            location.origin,
          )
        }
      }
      return originalFetch(input, init)
    }

    const body = parseJSONBody(init)

    const capturedBody = body === null ? null : adapter.refreshCapturedBody?.(body) ?? body

    window.postMessage(
      { type: adapter.messages.endpointCaptured, url, body: capturedBody },
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

    const [s1, s2] = response.body.tee()

    void (async () => {
      const reader = s2.getReader()
      const decoder = new TextDecoder()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value !== undefined && adapter.isStreamDone?.(decoder.decode(value))) {
            break
          }
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
