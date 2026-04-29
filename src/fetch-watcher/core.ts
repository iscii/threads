import type { NetworkAdapter } from '@/types'

export function createFetchWatcher(
  adapter: NetworkAdapter,
  originalFetch: typeof fetch,
) {
  let _stagedSummaries: string[] = []

  function handleMessage(event: MessageEvent): void {
    if (event.source !== window) return
    const data = event.data as { type?: string; summaryTexts?: string[] }
    if (data?.type === 'THR_STAGE_SUMMARY') {
      _stagedSummaries = data.summaryTexts ?? []
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

    // Matching completion POST — full implementation added in Task 6
    return originalFetch(input, init)
  }

  return { interceptFetch, handleMessage }
}
