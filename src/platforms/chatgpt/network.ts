import type { NetworkAdapter } from '@/types'

export const chatgptAdapter: NetworkAdapter = {
  urlPattern: /^$/,
  messages: {
    endpointCaptured: 'CHATGPT_ENDPOINT_CAPTURED',
    summaryInjected: 'CHATGPT_SUMMARY_INJECTED',
    streamComplete: 'CHATGPT_STREAM_COMPLETE',
  },
  inject(body) { return { body, injected: false } },
  buildCompletion(capturedBody) { return capturedBody },
}
