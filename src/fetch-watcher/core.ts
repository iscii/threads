import type { NetworkAdapter } from '@/types'
import { MSG } from '@/messaging'
import { CLAUDE_MSG } from '@/platforms/claude/messaging'

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
      // non-JSON body — pass through unmodified
    }

    window.postMessage(
      { type: CLAUDE_MSG.ENDPOINT_CAPTURED, url, body },
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
      }
    }

    const response = await originalFetch(input, modifiedInit)

    if (!response.body) {
      if (injected) {
        window.postMessage({ type: CLAUDE_MSG.SUMMARY_INJECTED }, location.origin)
      }
      window.postMessage({ type: CLAUDE_MSG.STREAM_COMPLETE }, location.origin)
      return response
    }

    const [s1, s2] = response.body.tee()

    void (async () => {
      const reader = s2.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (
            value !== undefined &&
            adapter.isStreamDone?.(new TextDecoder().decode(value))
          ) {
            break
          }
        }
      } finally {
        reader.releaseLock()
        window.postMessage({ type: CLAUDE_MSG.STREAM_COMPLETE }, location.origin)
      }
    })()

    if (injected) {
      window.postMessage({ type: CLAUDE_MSG.SUMMARY_INJECTED }, location.origin)
    }

    return new Response(s1, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }

  return { interceptFetch, handleMessage }
}
