import type { NetworkAdapter } from '@/types'

export const deepseekAdapter: NetworkAdapter = {
  urlPattern: /^$/,
  messages: {
    endpointCaptured: 'DEEPSEEK_ENDPOINT_CAPTURED',
    summaryInjected: 'DEEPSEEK_SUMMARY_INJECTED',
    streamComplete: 'DEEPSEEK_STREAM_COMPLETE',
  },
  inject(body, _summaries) { return { body, injected: false } },
  buildCompletion(capturedBody) { return capturedBody },
}
