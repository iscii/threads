import type { NetworkAdapter } from '@/types'
import { threads, endpointInfo } from '../lib/threads'
import { initQueue, sendThreadReply } from './useQueue'

function makeAdapter(): NetworkAdapter {
  return {
    urlPattern: /completion/,
    messages: {
      endpointCaptured: 'endpoint',
      summaryInjected: 'summary',
      streamComplete: 'stream',
    },
    inject: vi.fn(),
    buildCompletion: vi.fn((_, prompt: string) => ({ prompt })),
  }
}

function sse(text: string): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ completion: text })}\n\n`))
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      },
    }),
  )
}

beforeAll(() => {
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        set: vi.fn(),
        get: vi.fn().mockResolvedValue({}),
        remove: vi.fn(),
      },
    },
  })
  Object.defineProperty(window, 'location', {
    value: {
      origin: 'https://claude.ai',
      href: 'https://claude.ai/chat/test',
      pathname: '/chat/test',
    },
    configurable: true,
  })
})

beforeEach(() => {
  vi.clearAllMocks()
  threads.value = [
    {
      id: 'thread1',
      blockId: 'block1',
      blockText: 'source passage',
      messages: [{ role: 'user', content: 'Hi' }],
      included: true,
      isTyping: false,
      isOpen: true,
    },
  ]
  endpointInfo.value = { url: '/completion', body: { prompt: '' } }
})

describe('sendThreadReply', () => {
  it('prefixes prompt with threads-ext-marker', async () => {
    const adapter = makeAdapter()
    initQueue(adapter)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sse('The answer.')))

    await sendThreadReply('thread1', 'What is this?')

    expect(adapter.buildCompletion).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(/^<threads-ext-marker\/>[\s\S]*concise assistant/),
    )
  })
})
