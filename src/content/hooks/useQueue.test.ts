import { vi, beforeEach } from 'vitest'
import type { NetworkAdapter } from '@/types'
import { initQueue, sendThreadReply } from './useQueue'
import { threads, endpointInfo, openThread, setEndpointInfo } from '../lib/threads'

const adapter: NetworkAdapter = {
  urlPattern: /completion/,
  messages: {
    endpointCaptured: 'ENDPOINT_CAPTURED',
    summaryInjected: 'SUMMARY_INJECTED',
    streamComplete: 'STREAM_COMPLETE',
  },
  inject: vi.fn().mockReturnValue({ body: {}, injected: false }),
  buildCompletion: vi.fn((body, prompt) => ({ ...(body as object), prompt })),
}

beforeAll(() => {
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        set: vi.fn(),
        get: vi.fn((_, cb) => {
          cb?.({})
          return Promise.resolve({})
        }),
        remove: vi.fn(),
      },
    },
  })
  Object.defineProperty(window, 'location', {
    value: { pathname: '/chat/test-conv', origin: 'https://claude.ai' },
    configurable: true,
  })
})

beforeEach(() => {
  vi.restoreAllMocks()
  threads.value = []
  endpointInfo.value = null
  localStorage.clear()
  initQueue(adapter)
})

describe('sendThreadReply endpoint fallback', () => {
  it('clears stale persisted endpoint info and asks for a main-chat message when the request is rejected', async () => {
    openThread('block1', 'Block text')
    const id = threads.value[0].id
    setEndpointInfo({
      url: 'https://claude.ai/api/organizations/org/chat_conversations/test-conv/completion',
      body: { prompt: 'stale', token: 'stale-token' },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })))

    await sendThreadReply(id, 'hello')

    expect(endpointInfo.value).toBeNull()
    expect(localStorage.getItem('endpoint:test-conv')).toBeNull()
    expect(threads.value[0].messages.at(-1)?.content).toBe(
      '(Send a message in the main chat first to initialize the connection.)',
    )
  })
})
