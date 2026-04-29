import type { NetworkAdapter } from '@/types'
import { MSG } from '@/messaging'

export function createFetchWatcher(
  adapter: NetworkAdapter,
  originalFetch: typeof fetch,
) {
  let stagedSummaries: string[] = []

  function handleMessage(event: MessageEvent): void {
    if (event.source !== window) return
    const data = event.data as { type?: string; summaryTexts?: string[] }
    if (data?.type === MSG.STAGE_SUMMARY) {
      stagedSummaries = data.summaryTexts ?? []
      console.debug('[fw] summaries staged:', stagedSummaries)
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

    if (method !== 'POST' || !adapter.urlPattern.test(url)) {
      return originalFetch(input, init)
    }

    let body: unknown = null
    try {
      body = JSON.parse(init.body as string)
    } catch {
      // Non-JSON body: adapter.inject only understands structured bodies, so skip
      // injection and keep staged summaries for the next request.
    }

    window.postMessage(
      { type: adapter.messages.endpointCaptured, url, body },
      location.origin,
    )

    let injected = false
    let modifiedInit = init

    if (stagedSummaries.length > 0 && body !== null) {
      const modified = adapter.inject(body, stagedSummaries)
      if (modified !== null) {
        modifiedInit = { ...init, body: JSON.stringify(modified) }
        stagedSummaries = []
        injected = true
      } else {
        console.warn('[fw] inject() returned null — request shape may have changed. Summaries kept for next request. Body keys:', Object.keys(body as object))
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
